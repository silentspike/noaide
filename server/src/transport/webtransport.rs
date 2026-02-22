use std::collections::VecDeque;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use anyhow::Context;
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

/// Default capacity for the replay buffer (number of events).
const REPLAY_BUFFER_CAPACITY: usize = 1000;

// ── Replay Buffer ───────────────────────────────────────────────────────────

/// Buffered event for delta sync replay.
pub(crate) struct BufferedEvent {
    /// Lamport timestamp for delta sync filtering (used when clients send last_logical_ts).
    #[allow(dead_code)]
    pub(crate) logical_ts: u64,
    pub(crate) topic: String,
    pub(crate) wire_frame: Vec<u8>,
}

/// Ring buffer of recent encoded events for delta sync on reconnect.
///
/// New connections replay buffered events so clients that reconnect
/// don't miss events published while they were disconnected.
pub struct RecentEventBuffer {
    buffer: VecDeque<BufferedEvent>,
    max_size: usize,
}

impl RecentEventBuffer {
    /// Create a new buffer with the given capacity.
    pub fn new(max_size: usize) -> Self {
        Self {
            buffer: VecDeque::with_capacity(max_size),
            max_size,
        }
    }

    /// Push an encoded event into the buffer, evicting oldest if full.
    pub fn push(&mut self, logical_ts: u64, topic: String, wire_frame: Vec<u8>) {
        if self.buffer.len() >= self.max_size {
            self.buffer.pop_front();
        }
        self.buffer.push_back(BufferedEvent {
            logical_ts,
            topic,
            wire_frame,
        });
    }

    /// Iterate over all buffered events (oldest first).
    pub(crate) fn iter(&self) -> impl Iterator<Item = &BufferedEvent> {
        self.buffer.iter()
    }

    /// Get events with logical_ts strictly greater than the given timestamp.
    /// Used when clients send their last seen timestamp for filtered replay.
    #[allow(dead_code)]
    pub(crate) fn events_since(
        &self,
        last_logical_ts: u64,
    ) -> impl Iterator<Item = &BufferedEvent> {
        self.buffer
            .iter()
            .filter(move |e| e.logical_ts > last_logical_ts)
    }

    /// Number of events in the buffer.
    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    /// Whether the buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }
}

// ── TransportServer ─────────────────────────────────────────────────────────

/// WebTransport server for streaming events to browser clients.
///
/// Uses the wtransport crate which implements the full HTTP/3 + WebTransport
/// protocol stack on top of quinn/QUIC. This is required because browsers'
/// `new WebTransport()` API expects HTTP/3 CONNECT semantics, not raw QUIC.
///
/// Each client connection subscribes to all bus topics and receives a
/// multiplexed event stream via a WebTransport unidirectional stream.
///
/// Wire format per event:
/// `[2 bytes topic_len BE][topic bytes][1 byte codec_id][4 bytes payload_len BE][compressed payload]`
pub struct TransportServer {
    endpoint: wtransport::Endpoint<wtransport::endpoint::endpoint_side::Server>,
    bind_addr: SocketAddr,
    bus: Arc<dyn EventBus>,
    active_connections: Arc<AtomicUsize>,
    recent_events: Arc<tokio::sync::Mutex<RecentEventBuffer>>,
    /// SHA-256 digest of the server certificate (32 bytes).
    /// Used by browsers via `serverCertificateHashes` to trust self-signed certs.
    cert_hash: [u8; 32],
}

impl TransportServer {
    /// Create a new WebTransport server with a self-signed certificate.
    ///
    /// Generates a fresh ECDSA P-256 certificate valid for 14 days. The SHA-256
    /// hash is exposed via `cert_hash()` so the frontend can use
    /// `serverCertificateHashes` to trust the connection without a CA.
    pub fn new_self_signed(bind_addr: SocketAddr, bus: Arc<dyn EventBus>) -> anyhow::Result<Self> {
        let identity = wtransport::Identity::self_signed(["localhost", "127.0.0.1", "::1"])
            .context("generate self-signed identity")?;

        let cert_digest = identity.certificate_chain().as_slice()[0].hash();
        let cert_hash: [u8; 32] = *cert_digest.as_ref();

        let port = bind_addr.port();
        let config = wtransport::ServerConfig::builder()
            .with_bind_default(port)
            .with_identity(identity)
            .keep_alive_interval(Some(Duration::from_secs(5)))
            .max_idle_timeout(Some(Duration::from_secs(30)))
            .context("invalid idle timeout")?
            .build();

        let endpoint = wtransport::Endpoint::server(config)
            .context("failed to create WebTransport endpoint")?;

        info!(port, "transport server listening (self-signed, dual-stack)");

        Ok(Self {
            endpoint,
            bind_addr,
            bus,
            active_connections: Arc::new(AtomicUsize::new(0)),
            recent_events: Arc::new(tokio::sync::Mutex::new(RecentEventBuffer::new(
                REPLAY_BUFFER_CAPACITY,
            ))),
            cert_hash,
        })
    }

    /// Create a new WebTransport server with PEM certificate files.
    ///
    /// Loads TLS certificate and key from PEM files for QUIC/TLS 1.3 encryption.
    /// The cert hash is computed from the leaf certificate for `serverCertificateHashes`.
    pub async fn new(
        bind_addr: SocketAddr,
        tls_cert: &Path,
        tls_key: &Path,
        bus: Arc<dyn EventBus>,
    ) -> anyhow::Result<Self> {
        let identity = wtransport::Identity::load_pemfiles(tls_cert, tls_key)
            .await
            .context("load TLS identity")?;

        let cert_digest = identity.certificate_chain().as_slice()[0].hash();
        let cert_hash: [u8; 32] = *cert_digest.as_ref();

        let port = bind_addr.port();
        let config = wtransport::ServerConfig::builder()
            .with_bind_default(port)
            .with_identity(identity)
            .keep_alive_interval(Some(Duration::from_secs(5)))
            .max_idle_timeout(Some(Duration::from_secs(30)))
            .context("invalid idle timeout")?
            .build();

        let endpoint = wtransport::Endpoint::server(config)
            .context("failed to create WebTransport endpoint")?;

        info!(port, "transport server listening (dual-stack)");

        Ok(Self {
            endpoint,
            bind_addr,
            bus,
            active_connections: Arc::new(AtomicUsize::new(0)),
            recent_events: Arc::new(tokio::sync::Mutex::new(RecentEventBuffer::new(
                REPLAY_BUFFER_CAPACITY,
            ))),
            cert_hash,
        })
    }

    /// Accept and handle incoming WebTransport sessions until the endpoint is closed.
    pub async fn run(&self) -> anyhow::Result<()> {
        info!("accepting WebTransport connections");

        // Start buffer writer for delta sync replay
        let buffer = self.recent_events.clone();
        let bus_for_buffer = self.bus.clone();
        tokio::spawn(async move {
            buffer_writer(bus_for_buffer, buffer).await;
        });

        loop {
            // Accept incoming WebTransport session (HTTP/3 CONNECT handshake)
            let incoming_session = self.endpoint.accept().await;

            let bus = self.bus.clone();
            let counter = self.active_connections.clone();
            let recent = self.recent_events.clone();

            counter.fetch_add(1, Ordering::Relaxed);

            tokio::spawn(async move {
                // Wait for session request (HTTP/3 layer)
                let session_request = match incoming_session.await {
                    Ok(req) => req,
                    Err(e) => {
                        warn!(error = %e, "WebTransport session request failed");
                        counter.fetch_sub(1, Ordering::Relaxed);
                        return;
                    }
                };

                info!(
                    authority = session_request.authority(),
                    path = session_request.path(),
                    active = counter.load(Ordering::Relaxed),
                    "WebTransport session request"
                );

                // Accept the session (completes HTTP/3 CONNECT handshake)
                let conn = match session_request.accept().await {
                    Ok(c) => c,
                    Err(e) => {
                        warn!(error = %e, "WebTransport session accept failed");
                        counter.fetch_sub(1, Ordering::Relaxed);
                        return;
                    }
                };

                if let Err(e) = handle_connection(conn, bus, recent).await {
                    warn!(error = %e, "connection handler error");
                }

                let remaining = counter.fetch_sub(1, Ordering::Relaxed) - 1;
                debug!(active = remaining, "connection closed");
            });
        }
    }

    /// Number of currently active client connections.
    pub fn connection_count(&self) -> usize {
        self.active_connections.load(Ordering::Relaxed)
    }

    /// Get the address the server is bound to.
    pub fn local_addr(&self) -> SocketAddr {
        self.bind_addr
    }

    /// SHA-256 hash of the server certificate (32 bytes).
    ///
    /// Used by browsers via `serverCertificateHashes` in the `WebTransport` constructor
    /// to trust self-signed certificates without a CA.
    pub fn cert_hash(&self) -> &[u8; 32] {
        &self.cert_hash
    }

    /// Certificate hash as base64 string (for HTTP API / frontend consumption).
    pub fn cert_hash_base64(&self) -> String {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(self.cert_hash)
    }

    /// Close the endpoint, rejecting new connections.
    pub fn close(&self) {
        // wtransport doesn't expose a direct close — dropping the endpoint stops it.
        // For tests, we just log and let the struct drop.
        info!("transport server closed");
    }
}

// ── Connection Handler ──────────────────────────────────────────────────────

/// Handle a single WebTransport client: subscribe to bus, stream events.
async fn handle_connection(
    conn: wtransport::Connection,
    bus: Arc<dyn EventBus>,
    recent_events: Arc<tokio::sync::Mutex<RecentEventBuffer>>,
) -> anyhow::Result<()> {
    let remote = conn.remote_address();
    info!(remote = %remote, "WebTransport connection established");

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

    // Open unidirectional stream for event delivery (two await points per wtransport API)
    let opening = conn.open_uni().await.context("allocate event stream")?;
    let mut send = opening.await.context("open event stream")?;

    // Delta sync: replay buffered events to new connections.
    // Clone frames under the lock, then write without holding it.
    let replay_frames: Vec<Vec<u8>> = {
        let buffer = recent_events.lock().await;
        let q = quality.lock().await;
        buffer
            .iter()
            .filter(|e| q.should_send(&e.topic))
            .map(|e| e.wire_frame.clone())
            .collect()
    };
    if !replay_frames.is_empty() {
        debug!(
            remote = %remote,
            events = replay_frames.len(),
            "replaying buffered events"
        );
        for frame in &replay_frames {
            if let Err(e) = send.write_all(frame).await {
                debug!(error = %e, "replay write failed");
                return Ok(());
            }
        }
    }

    // Event delivery + RTT measurement loop
    let mut rtt_interval = tokio::time::interval(Duration::from_millis(100));

    loop {
        tokio::select! {
            _ = rtt_interval.tick() => {
                let rtt = conn.rtt();
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

// ── Buffer Writer ───────────────────────────────────────────────────────────

/// Background task that captures all bus events into the replay buffer.
///
/// Runs for the lifetime of the server. Each event is encoded and stored
/// so new connections can replay recent history (delta sync).
async fn buffer_writer(bus: Arc<dyn EventBus>, buffer: Arc<tokio::sync::Mutex<RecentEventBuffer>>) {
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
                                warn!(
                                    topic = topic_owned.as_str(),
                                    missed = n,
                                    "buffer writer lagged"
                                );
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                });
            }
            Err(e) => {
                warn!(topic, error = %e, "buffer writer subscribe failed");
            }
        }
    }
    drop(tx);

    while let Some((topic, envelope)) = rx.recv().await {
        let path = codec_path_for_topic(&topic);
        match WireCodec::encode(&envelope, path) {
            Ok(frame) => {
                let logical_ts = envelope.logical_ts;
                let topic_bytes = topic.as_bytes();
                let topic_len = (topic_bytes.len() as u16).to_be_bytes();
                let mut wire = Vec::with_capacity(2 + topic_bytes.len() + frame.len());
                wire.extend_from_slice(&topic_len);
                wire.extend_from_slice(topic_bytes);
                wire.extend_from_slice(&frame);

                buffer.lock().await.push(logical_ts, topic, wire);
            }
            Err(e) => {
                warn!(error = %e, "buffer writer encode failed");
            }
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn server_bind_and_close() {
        let bus = crate::bus::create_event_bus(false).await.unwrap();
        let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
        let server = TransportServer::new_self_signed(addr, bus).unwrap();

        assert_eq!(server.connection_count(), 0);
        assert_eq!(server.cert_hash().len(), 32);
        server.close();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn connection_counter_starts_at_zero() {
        let bus = crate::bus::create_event_bus(false).await.unwrap();
        let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
        let server = TransportServer::new_self_signed(addr, bus).unwrap();

        assert_eq!(server.connection_count(), 0);
        assert!(!server.cert_hash_base64().is_empty());
        server.close();
    }

    #[test]
    fn replay_buffer_push_and_evict() {
        let mut buf = RecentEventBuffer::new(3);
        assert_eq!(buf.len(), 0);

        buf.push(1, "a".into(), vec![1]);
        buf.push(2, "b".into(), vec![2]);
        buf.push(3, "c".into(), vec![3]);
        assert_eq!(buf.len(), 3);

        // Fourth push evicts oldest
        buf.push(4, "d".into(), vec![4]);
        assert_eq!(buf.len(), 3);

        let items: Vec<u64> = buf.iter().map(|e| e.logical_ts).collect();
        assert_eq!(items, vec![2, 3, 4]);
    }

    #[test]
    fn replay_buffer_events_since() {
        let mut buf = RecentEventBuffer::new(10);
        buf.push(1, "a".into(), vec![]);
        buf.push(5, "b".into(), vec![]);
        buf.push(10, "c".into(), vec![]);

        let since_3: Vec<u64> = buf.events_since(3).map(|e| e.logical_ts).collect();
        assert_eq!(since_3, vec![5, 10]);

        let since_0: Vec<u64> = buf.events_since(0).map(|e| e.logical_ts).collect();
        assert_eq!(since_0, vec![1, 5, 10]);

        let since_10: Vec<u64> = buf.events_since(10).map(|e| e.logical_ts).collect();
        assert!(since_10.is_empty());
    }
}
