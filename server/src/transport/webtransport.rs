use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use anyhow::Context;
use quinn::Connection;
use tracing::{debug, info, warn};

use crate::bus::EventBus;
use crate::bus::topics::{
    AGENT_METRICS, API_REQUESTS, FILE_CHANGES, SESSION_MESSAGES, SYSTEM_EVENTS, TASK_UPDATES,
};

use super::adaptive::AdaptiveQuality;
use super::codec::{WireCodec, codec_path_for_topic};

/// All topics each connected client receives.
const ALL_TOPICS: &[&str] = &[
    SESSION_MESSAGES,
    FILE_CHANGES,
    SYSTEM_EVENTS,
    TASK_UPDATES,
    AGENT_METRICS,
    API_REQUESTS,
];

// ── TransportServer ─────────────────────────────────────────────────────────

/// QUIC-based transport server for streaming events to browser clients.
///
/// Each client connection subscribes to all bus topics and receives a
/// multiplexed event stream via a single QUIC unidirectional stream.
///
/// Wire format per event:
/// `[2 bytes topic_len BE][topic bytes][1 byte codec_id][4 bytes payload_len BE][compressed payload]`
pub struct TransportServer {
    endpoint: quinn::Endpoint,
    bus: Arc<dyn EventBus>,
    active_connections: Arc<AtomicUsize>,
}

impl TransportServer {
    /// Create a new transport server bound to the given address.
    ///
    /// Loads TLS certificate and key from PEM files for QUIC encryption.
    pub async fn new(
        bind_addr: SocketAddr,
        tls_cert: &Path,
        tls_key: &Path,
        bus: Arc<dyn EventBus>,
    ) -> anyhow::Result<Self> {
        let server_config = build_server_config(tls_cert, tls_key)?;
        let endpoint = quinn::Endpoint::server(server_config, bind_addr)
            .context("failed to create QUIC endpoint")?;

        info!(addr = %bind_addr, "transport server listening");

        Ok(Self {
            endpoint,
            bus,
            active_connections: Arc::new(AtomicUsize::new(0)),
        })
    }

    /// Accept and handle incoming connections until the endpoint is closed.
    pub async fn run(&self) -> anyhow::Result<()> {
        info!("accepting connections");

        while let Some(incoming) = self.endpoint.accept().await {
            let bus = self.bus.clone();
            let counter = self.active_connections.clone();

            counter.fetch_add(1, Ordering::Relaxed);
            let remote = incoming.remote_address();
            info!(
                remote = %remote,
                active = counter.load(Ordering::Relaxed),
                "connection incoming"
            );

            tokio::spawn(async move {
                match incoming.await {
                    Ok(conn) => {
                        if let Err(e) = handle_connection(conn, bus).await {
                            warn!(error = %e, "connection handler error");
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "connection handshake failed");
                    }
                }
                let remaining = counter.fetch_sub(1, Ordering::Relaxed) - 1;
                debug!(active = remaining, "connection closed");
            });
        }

        Ok(())
    }

    /// Number of currently active client connections.
    pub fn connection_count(&self) -> usize {
        self.active_connections.load(Ordering::Relaxed)
    }

    /// Get the local address the server is bound to.
    pub fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.endpoint.local_addr()
    }

    /// Close the endpoint, rejecting new connections.
    pub fn close(&self) {
        self.endpoint
            .close(quinn::VarInt::from_u32(0), b"server shutdown");
        info!("transport server closed");
    }
}

// ── TLS Configuration ───────────────────────────────────────────────────────

/// Build a quinn ServerConfig from PEM cert/key files.
fn build_server_config(cert_path: &Path, key_path: &Path) -> anyhow::Result<quinn::ServerConfig> {
    let cert_pem =
        std::fs::read(cert_path).with_context(|| format!("read cert: {}", cert_path.display()))?;
    let key_pem =
        std::fs::read(key_path).with_context(|| format!("read key: {}", key_path.display()))?;

    // Parse PEM certificates
    let certs: Vec<_> = rustls_pemfile::certs(&mut &cert_pem[..])
        .collect::<Result<Vec<_>, _>>()
        .context("parse TLS certificates")?;
    anyhow::ensure!(!certs.is_empty(), "no certificates in PEM file");

    // Parse private key (PKCS8, RSA, or EC)
    let key = rustls_pemfile::private_key(&mut &key_pem[..])
        .context("parse TLS private key")?
        .context("no private key in PEM file")?;

    // Rustls config
    let mut crypto = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .context("invalid cert/key pair")?;

    // ALPN for HTTP/3 (required for WebTransport)
    crypto.alpn_protocols = vec![b"h3".to_vec()];

    // QUIC config from rustls
    let quic_crypto = quinn::crypto::rustls::QuicServerConfig::try_from(crypto)
        .map_err(|e| anyhow::anyhow!("QUIC crypto config: {e}"))?;

    let mut config = quinn::ServerConfig::with_crypto(Arc::new(quic_crypto));

    // Transport tuning
    let mut transport = quinn::TransportConfig::default();
    transport.keep_alive_interval(Some(Duration::from_secs(5)));
    // 30 second idle timeout — clients should send keep-alive pings
    if let Ok(timeout) = quinn::IdleTimeout::try_from(Duration::from_secs(30)) {
        transport.max_idle_timeout(Some(timeout));
    }
    config.transport_config(Arc::new(transport));

    Ok(config)
}

// ── Connection Handler ──────────────────────────────────────────────────────

/// Handle a single client connection: subscribe to bus, stream events.
async fn handle_connection(conn: Connection, bus: Arc<dyn EventBus>) -> anyhow::Result<()> {
    let remote = conn.remote_address();
    info!(remote = %remote, "connection established");

    let quality = Arc::new(tokio::sync::Mutex::new(AdaptiveQuality::new()));

    // Multiplex all topic receivers into a single mpsc channel
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(String, crate::bus::EventEnvelope)>(1000);

    for &topic in ALL_TOPICS {
        match bus.subscribe(topic).await {
            Ok(mut bus_rx) => {
                let tx = tx.clone();
                let topic_owned = topic.to_string();
                tokio::spawn(async move {
                    loop {
                        match bus_rx.recv().await {
                            Ok(envelope) => {
                                if tx.send((topic_owned.clone(), envelope)).await.is_err() {
                                    break;
                                }
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                warn!(topic = topic_owned.as_str(), missed = n, "receiver lagged");
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                });
            }
            Err(e) => {
                warn!(topic, error = %e, "subscribe failed");
            }
        }
    }
    drop(tx); // Close our sender so rx completes when all forwarders drop

    // Open unidirectional stream for event delivery
    let mut send = conn.open_uni().await.context("open event stream")?;

    // Event delivery + RTT measurement loop
    let mut rtt_interval = tokio::time::interval(Duration::from_millis(100));

    loop {
        tokio::select! {
            _ = rtt_interval.tick() => {
                let rtt = conn.stats().path.rtt;
                quality.lock().await.update_rtt(rtt);
            }
            event = rx.recv() => {
                match event {
                    Some((topic, envelope)) => {
                        if !quality.lock().await.should_send(&topic) {
                            continue;
                        }

                        let path = codec_path_for_topic(&topic);
                        match WireCodec::encode(&envelope, path) {
                            Ok(frame) => {
                                // Topic-prefixed frame
                                let topic_bytes = topic.as_bytes();
                                let topic_len = (topic_bytes.len() as u16).to_be_bytes();
                                let mut wire =
                                    Vec::with_capacity(2 + topic_bytes.len() + frame.len());
                                wire.extend_from_slice(&topic_len);
                                wire.extend_from_slice(topic_bytes);
                                wire.extend_from_slice(&frame);

                                if let Err(e) = send.write_all(&wire).await {
                                    debug!(error = %e, "stream write failed");
                                    return Ok(());
                                }
                            }
                            Err(e) => {
                                warn!(topic = topic.as_str(), error = %e, "encode failed");
                            }
                        }
                    }
                    None => {
                        info!("all bus channels closed");
                        return Ok(());
                    }
                }
            }
            reason = conn.closed() => {
                info!(remote = %remote, reason = ?reason, "connection closed");
                return Ok(());
            }
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn generate_test_certs() -> (Vec<u8>, Vec<u8>) {
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let cert_pem = cert.cert.pem().into_bytes();
        let key_pem = cert.key_pair.serialize_pem().into_bytes();
        (cert_pem, key_pem)
    }

    #[test]
    fn build_server_config_with_valid_certs() {
        let (cert_pem, key_pem) = generate_test_certs();

        let dir = tempfile::tempdir().unwrap();
        let cert_path = dir.path().join("cert.pem");
        let key_path = dir.path().join("key.pem");
        std::fs::write(&cert_path, &cert_pem).unwrap();
        std::fs::write(&key_path, &key_pem).unwrap();

        let config = build_server_config(&cert_path, &key_path);
        assert!(config.is_ok());
    }

    #[test]
    fn build_server_config_missing_cert() {
        let dir = tempfile::tempdir().unwrap();
        let result = build_server_config(
            &dir.path().join("nonexistent.pem"),
            &dir.path().join("key.pem"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn build_server_config_invalid_pem() {
        let dir = tempfile::tempdir().unwrap();
        let cert_path = dir.path().join("cert.pem");
        let key_path = dir.path().join("key.pem");
        std::fs::write(&cert_path, b"not a cert").unwrap();
        std::fs::write(&key_path, b"not a key").unwrap();

        let result = build_server_config(&cert_path, &key_path);
        assert!(result.is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn server_bind_and_close() {
        let (cert_pem, key_pem) = generate_test_certs();

        let dir = tempfile::tempdir().unwrap();
        let cert_path = dir.path().join("cert.pem");
        let key_path = dir.path().join("key.pem");
        std::fs::write(&cert_path, &cert_pem).unwrap();
        std::fs::write(&key_path, &key_pem).unwrap();

        let bus = crate::bus::create_event_bus(false).await.unwrap();

        let server =
            TransportServer::new("127.0.0.1:0".parse().unwrap(), &cert_path, &key_path, bus)
                .await
                .unwrap();

        assert_eq!(server.connection_count(), 0);
        server.close();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn connection_counter_starts_at_zero() {
        let (cert_pem, key_pem) = generate_test_certs();

        let dir = tempfile::tempdir().unwrap();
        let cert_path = dir.path().join("cert.pem");
        let key_path = dir.path().join("key.pem");
        std::fs::write(&cert_path, &cert_pem).unwrap();
        std::fs::write(&key_path, &key_pem).unwrap();

        let bus = crate::bus::create_event_bus(false).await.unwrap();
        let server =
            TransportServer::new("127.0.0.1:0".parse().unwrap(), &cert_path, &key_path, bus)
                .await
                .unwrap();

        assert_eq!(server.connection_count(), 0);
        server.close();
    }

    /// Build a quinn client config that trusts our self-signed cert.
    fn build_test_client_config(
        cert_der: rustls::pki_types::CertificateDer<'static>,
    ) -> quinn::ClientConfig {
        let mut roots = rustls::RootCertStore::empty();
        roots.add(cert_der).unwrap();
        let mut client_crypto = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        client_crypto.alpn_protocols = vec![b"h3".to_vec()];
        let quic = quinn::crypto::rustls::QuicClientConfig::try_from(client_crypto).unwrap();
        quinn::ClientConfig::new(Arc::new(quic))
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn end_to_end_event_delivery() {
        // Generate self-signed cert
        let certified = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let cert_pem = certified.cert.pem().into_bytes();
        let key_pem = certified.key_pair.serialize_pem().into_bytes();
        let cert_der = certified.cert.der().clone();

        let dir = tempfile::tempdir().unwrap();
        let cert_path = dir.path().join("cert.pem");
        let key_path = dir.path().join("key.pem");
        std::fs::write(&cert_path, &cert_pem).unwrap();
        std::fs::write(&key_path, &key_pem).unwrap();

        // Start server
        let bus = crate::bus::create_event_bus(false).await.unwrap();
        let server = TransportServer::new(
            "127.0.0.1:0".parse().unwrap(),
            &cert_path,
            &key_path,
            bus.clone(),
        )
        .await
        .unwrap();
        let server_addr = server.local_addr().unwrap();

        tokio::spawn(async move {
            let _ = server.run().await;
        });

        // Connect quinn client
        let client_config = build_test_client_config(cert_der);
        let mut client_ep = quinn::Endpoint::client("0.0.0.0:0".parse().unwrap()).unwrap();
        client_ep.set_default_client_config(client_config);

        let conn = client_ep
            .connect(server_addr, "localhost")
            .unwrap()
            .await
            .unwrap();

        // Spawn delayed publish — accept_uni blocks until the server
        // writes data to the stream, so publish must happen concurrently.
        let test_payload = b"integration test event".to_vec();
        let payload_clone = test_payload.clone();
        let bus_publish = bus.clone();
        tokio::spawn(async move {
            // Wait for server to subscribe + open stream
            tokio::time::sleep(Duration::from_millis(200)).await;
            let envelope = crate::bus::EventEnvelope::new(
                crate::bus::EventSource::User,
                0,
                0,
                None,
                payload_clone,
            );
            bus_publish
                .publish(crate::bus::SESSION_MESSAGES, envelope)
                .await
                .unwrap();
        });

        // accept_uni returns when server writes first data to the stream
        let mut recv = tokio::time::timeout(Duration::from_secs(5), conn.accept_uni())
            .await
            .expect("timeout waiting for event stream")
            .unwrap();

        // Read topic-prefixed frame from QUIC stream
        let mut topic_len_buf = [0u8; 2];
        tokio::time::timeout(Duration::from_secs(5), recv.read_exact(&mut topic_len_buf))
            .await
            .expect("timeout reading topic length")
            .unwrap();
        let topic_len = u16::from_be_bytes(topic_len_buf) as usize;

        let mut topic_buf = vec![0u8; topic_len];
        recv.read_exact(&mut topic_buf).await.unwrap();
        let topic = String::from_utf8(topic_buf).unwrap();

        // Read wire frame: [1 byte codec_id][4 bytes length BE][payload]
        let mut header = [0u8; 5];
        recv.read_exact(&mut header).await.unwrap();
        let payload_len = u32::from_be_bytes([header[1], header[2], header[3], header[4]]) as usize;

        let mut payload = vec![0u8; payload_len];
        recv.read_exact(&mut payload).await.unwrap();

        // Reconstruct frame and decode
        let mut frame = Vec::with_capacity(5 + payload_len);
        frame.extend_from_slice(&header);
        frame.extend_from_slice(&payload);
        let decoded = WireCodec::decode(&frame).unwrap();

        // Verify
        assert_eq!(topic, "session/messages");
        assert_eq!(decoded.payload, test_payload);
        assert_eq!(decoded.source, crate::bus::EventSource::User);

        // Cleanup
        conn.close(quinn::VarInt::from_u32(0), b"done");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn connection_count_increments() {
        let certified = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let cert_pem = certified.cert.pem().into_bytes();
        let key_pem = certified.key_pair.serialize_pem().into_bytes();
        let cert_der = certified.cert.der().clone();

        let dir = tempfile::tempdir().unwrap();
        let cert_path = dir.path().join("cert.pem");
        let key_path = dir.path().join("key.pem");
        std::fs::write(&cert_path, &cert_pem).unwrap();
        std::fs::write(&key_path, &key_pem).unwrap();

        let bus = crate::bus::create_event_bus(false).await.unwrap();
        let server =
            TransportServer::new("127.0.0.1:0".parse().unwrap(), &cert_path, &key_path, bus)
                .await
                .unwrap();
        let server_addr = server.local_addr().unwrap();

        // Capture connection count reference
        let server_active = server.active_connections.clone();

        tokio::spawn(async move {
            let _ = server.run().await;
        });

        // Connect
        let client_config = build_test_client_config(cert_der);
        let mut client_ep = quinn::Endpoint::client("0.0.0.0:0".parse().unwrap()).unwrap();
        client_ep.set_default_client_config(client_config);

        let conn = client_ep
            .connect(server_addr, "localhost")
            .unwrap()
            .await
            .unwrap();

        // Wait for connection to be established
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(server_active.load(Ordering::Relaxed), 1);

        // Disconnect
        conn.close(quinn::VarInt::from_u32(0), b"done");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(server_active.load(Ordering::Relaxed), 0);
    }
}
