//! TLS MITM infrastructure for the CONNECT proxy.
//!
//! Loads the mkcert root CA, generates per-host leaf certificates on the fly,
//! and provides TLS acceptor/connector for intercepting CONNECT tunnels.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use rcgen::{CertificateParams, DnType, ExtendedKeyUsagePurpose, Issuer, KeyPair, KeyUsagePurpose};
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer, ServerName};
use time::{Duration, OffsetDateTime};
use tokio::net::TcpStream;
use tokio_rustls::{TlsAcceptor, TlsConnector, client::TlsStream as ClientTlsStream};
use tracing::info;

/// How long generated leaf certs stay in the cache before regeneration.
const CERT_TTL: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// How often the cache cleanup task runs.
const CLEANUP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Cached leaf certificate for a hostname.
struct CachedCert {
    cert_der: CertificateDer<'static>,
    key_der: Vec<u8>,
    created_at: Instant,
}

/// Certificate Authority for MITM proxy.
///
/// Holds the mkcert root CA and generates per-host leaf certificates
/// signed by the CA. Certs are cached in a DashMap with 24h TTL.
pub struct CaAuthority {
    /// The mkcert root CA issuer — used to sign leaf certs.
    ca_issuer: Issuer<'static, KeyPair>,
    /// DER-encoded CA cert (included in leaf cert chains).
    ca_cert_der: CertificateDer<'static>,
    /// Per-hostname cert cache (lock-free concurrent reads).
    cert_cache: Arc<DashMap<String, CachedCert>>,
    /// Shared TLS client config for connecting to target hosts (platform roots).
    target_tls_config: Arc<rustls::ClientConfig>,
}

impl CaAuthority {
    /// Load the mkcert CA cert + key from disk.
    ///
    /// Search order for CA cert:
    ///   1. `NOAIDE_CA_CERT` env var
    ///   2. `./certs/rootCA.pem`
    ///   3. `~/.local/share/mkcert/rootCA.pem`
    ///
    /// Search order for CA key:
    ///   1. `NOAIDE_CA_KEY` env var
    ///   2. `./certs/rootCA-key.pem`
    ///   3. `~/.local/share/mkcert/rootCA-key.pem`
    ///
    /// CRITICAL: The key is NOT in certs/ by default — the production path
    /// is `~/.local/share/mkcert/rootCA-key.pem`.
    pub fn load_from_disk() -> anyhow::Result<Self> {
        let cert_pem_bytes = find_file("NOAIDE_CA_CERT", &["./certs/rootCA.pem"], "rootCA.pem")
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "CA cert not found (checked NOAIDE_CA_CERT, ./certs/rootCA.pem, \
                     ~/.local/share/mkcert/rootCA.pem)"
                )
            })?;

        let key_pem_bytes = find_file(
            "NOAIDE_CA_KEY",
            &["./certs/rootCA-key.pem"],
            "rootCA-key.pem",
        )
        .ok_or_else(|| {
            anyhow::anyhow!(
                "CA key not found (checked NOAIDE_CA_KEY, ./certs/rootCA-key.pem, \
                         ~/.local/share/mkcert/rootCA-key.pem)"
            )
        })?;

        let cert_pem = std::str::from_utf8(&cert_pem_bytes)?;
        let key_pem = std::str::from_utf8(&key_pem_bytes)?;

        // Parse the CA using rcgen's Issuer (the correct API for signing leaf certs)
        let ca_key_pair = KeyPair::from_pem(key_pem)?;
        let ca_issuer = Issuer::from_ca_cert_pem(cert_pem, ca_key_pair)?;

        // Also parse CA cert DER for including in leaf cert chains
        let ca_cert_pem = pem::parse(cert_pem).map_err(|e| anyhow::anyhow!("parse CA PEM: {e}"))?;
        let ca_cert_der = CertificateDer::from(ca_cert_pem.contents().to_vec());

        // Build TLS client config for connecting to real target hosts
        let mut root_store = rustls::RootCertStore::empty();
        for cert in rustls_native_certs::load_native_certs().certs {
            let _ = root_store.add(cert);
        }
        let target_tls_config = Arc::new(
            rustls::ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth(),
        );

        let cert_cache = Arc::new(DashMap::new());

        // Spawn periodic cleanup task for expired certs
        let cache_clone = cert_cache.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(CLEANUP_INTERVAL);
            loop {
                interval.tick().await;
                let now = Instant::now();
                cache_clone.retain(|_, cached: &mut CachedCert| {
                    now.duration_since(cached.created_at) < CERT_TTL
                });
            }
        });

        info!("CA loaded, CONNECT MITM ready");

        Ok(Self {
            ca_issuer,
            ca_cert_der,
            cert_cache,
            target_tls_config,
        })
    }

    /// Get or generate a leaf certificate for the given hostname.
    ///
    /// Returns cached cert if valid (<24h), otherwise generates a new one
    /// signed by the mkcert root CA.
    fn get_or_create_cert(
        &self,
        hostname: &str,
    ) -> anyhow::Result<(CertificateDer<'static>, Vec<u8>)> {
        // Check cache
        if let Some(cached) = self.cert_cache.get(hostname)
            && cached.created_at.elapsed() < CERT_TTL
        {
            return Ok((cached.cert_der.clone(), cached.key_der.clone()));
        }

        // Generate new leaf cert signed by our CA
        let leaf_key = KeyPair::generate()?;

        let mut params = CertificateParams::new(vec![hostname.to_string()])?;
        params.distinguished_name.push(DnType::CommonName, hostname);
        params.use_authority_key_identifier_extension = true;
        params.key_usages.push(KeyUsagePurpose::DigitalSignature);
        params
            .extended_key_usages
            .push(ExtendedKeyUsagePurpose::ServerAuth);

        // 24h validity with small backdate for clock skew
        let now = OffsetDateTime::now_utc();
        params.not_before = now.checked_sub(Duration::minutes(5)).unwrap_or(now);
        params.not_after = now.checked_add(Duration::days(1)).unwrap_or(now);

        let leaf_cert = params.signed_by(&leaf_key, &self.ca_issuer)?;

        let cert_der = CertificateDer::from(leaf_cert.der().to_vec());
        let key_der = leaf_key.serialized_der().to_vec();

        // Cache
        self.cert_cache.insert(
            hostname.to_string(),
            CachedCert {
                cert_der: cert_der.clone(),
                key_der: key_der.clone(),
                created_at: Instant::now(),
            },
        );

        Ok((cert_der, key_der))
    }

    /// Build a TLS acceptor for the client-facing side of the MITM.
    ///
    /// Uses a dynamically generated leaf cert for `hostname`, signed by the mkcert CA.
    pub fn build_tls_acceptor(&self, hostname: &str) -> anyhow::Result<TlsAcceptor> {
        let (cert_der, key_der) = self.get_or_create_cert(hostname)?;

        let mut server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![cert_der, self.ca_cert_der.clone()],
                rustls::pki_types::PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_der)),
            )?;

        // Advertise both HTTP/1.1 and h2 — prefer HTTP/1.1.
        // If client negotiates h2, the CONNECT handler falls back to byte-copy
        // (full HTTP/2 MITM requires the h2 crate, planned for Phase 0.6).
        server_config.alpn_protocols = vec![b"http/1.1".to_vec(), b"h2".to_vec()];

        Ok(TlsAcceptor::from(Arc::new(server_config)))
    }

    /// Connect to the real target host via TLS (for the proxy-to-target side).
    pub async fn connect_to_target(
        &self,
        hostname: &str,
        tcp_stream: TcpStream,
    ) -> anyhow::Result<ClientTlsStream<TcpStream>> {
        let connector = TlsConnector::from(self.target_tls_config.clone());
        let server_name = ServerName::try_from(hostname.to_string())?;
        let tls_stream = connector.connect(server_name, tcp_stream).await?;
        Ok(tls_stream)
    }
}

/// Search for a file: env var -> explicit paths -> mkcert default location.
fn find_file(env_var: &str, explicit_paths: &[&str], mkcert_filename: &str) -> Option<Vec<u8>> {
    // 1. Environment variable
    if let Ok(path) = std::env::var(env_var)
        && let Ok(data) = std::fs::read(&path)
    {
        return Some(data);
    }

    // 2. Explicit paths (e.g. ./certs/rootCA.pem)
    for path in explicit_paths {
        if let Ok(data) = std::fs::read(path) {
            return Some(data);
        }
    }

    // 3. mkcert default location: ~/.local/share/mkcert/{filename}
    if let Ok(home) = std::env::var("HOME") {
        let mkcert_path = PathBuf::from(home)
            .join(".local/share/mkcert")
            .join(mkcert_filename);
        if let Ok(data) = std::fs::read(&mkcert_path) {
            return Some(data);
        }
    }

    None
}

/// Find the CA cert file path (not contents) for setting env vars in managed sessions.
///
/// Search order: `NOAIDE_CA_CERT` env -> `./certs/rootCA.pem` -> `~/.local/share/mkcert/rootCA.pem`
pub fn find_ca_cert_path() -> Option<String> {
    if let Ok(path) = std::env::var("NOAIDE_CA_CERT")
        && std::fs::metadata(&path).is_ok()
    {
        return Some(path);
    }

    let certs_path = "./certs/rootCA.pem";
    if std::fs::metadata(certs_path).is_ok() {
        // Return absolute path for child processes
        if let Ok(abs) = std::fs::canonicalize(certs_path) {
            return Some(abs.to_string_lossy().to_string());
        }
        return Some(certs_path.to_string());
    }

    if let Ok(home) = std::env::var("HOME") {
        let mkcert_path = format!("{home}/.local/share/mkcert/rootCA.pem");
        if std::fs::metadata(&mkcert_path).is_ok() {
            return Some(mkcert_path);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_ca_cert_path_finds_something() {
        let path = find_ca_cert_path();
        if path.is_none() {
            eprintln!("SKIP: No CA cert found on this machine");
            return;
        }
        let p = path.unwrap();
        assert!(std::fs::metadata(&p).is_ok(), "Path {p} should exist");
    }

    #[test]
    fn test_find_file_env_nonexistent() {
        // SAFETY: test runs single-threaded, no other thread reads this var
        unsafe { std::env::set_var("_TEST_NOAIDE_CA", "/tmp/nonexistent-test-ca.pem") };
        let result = find_file("_TEST_NOAIDE_CA", &[], "rootCA.pem");
        assert!(result.is_none());
        unsafe { std::env::remove_var("_TEST_NOAIDE_CA") };
    }

    #[test]
    fn test_find_file_mkcert_fallback() {
        // Should find the real mkcert CA cert via fallback
        let result = find_file("_NONEXISTENT_VAR", &["/tmp/no-such-file"], "rootCA.pem");
        if result.is_none() {
            eprintln!("SKIP: mkcert not installed");
            return;
        }
        assert!(!result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_ca_load_and_generate() {
        match CaAuthority::load_from_disk() {
            Ok(ca) => {
                // Generate a cert
                let (cert, key) = ca
                    .get_or_create_cert("test.example.com")
                    .expect("cert generation failed");
                assert!(!cert.as_ref().is_empty());
                assert!(!key.is_empty());

                // Cache hit: same cert returned
                let (cert2, _) = ca
                    .get_or_create_cert("test.example.com")
                    .expect("cached cert failed");
                assert_eq!(
                    cert.as_ref(),
                    cert2.as_ref(),
                    "cache should return same cert"
                );

                // Different hostname: different cert
                let (cert3, _) = ca
                    .get_or_create_cert("other.example.com")
                    .expect("different host cert failed");
                assert_ne!(
                    cert.as_ref(),
                    cert3.as_ref(),
                    "different host should get different cert"
                );
            }
            Err(e) => {
                eprintln!("SKIP: CA not available on this machine: {e}");
            }
        }
    }

    #[tokio::test]
    async fn test_build_tls_acceptor() {
        match CaAuthority::load_from_disk() {
            Ok(ca) => {
                let acceptor = ca.build_tls_acceptor("mitm-test.example.com");
                assert!(acceptor.is_ok(), "TLS acceptor should build successfully");
            }
            Err(e) => {
                eprintln!("SKIP: CA not available: {e}");
            }
        }
    }
}
