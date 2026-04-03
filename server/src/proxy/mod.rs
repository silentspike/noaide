pub mod classify;
pub mod handler;
pub mod inject;
pub mod keys;
pub mod mitm;
pub mod modes;
pub mod persist;
pub mod rewrite;
pub mod rules;
pub mod tls_mitm;
pub mod websocket;

use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use axum::routing::any;
use tokio::sync::{RwLock, broadcast};
use tracing::info;

pub use classify::TrafficCategory;
pub use handler::{
    InterceptDecision, InterceptMode, PendingIntercept, PendingResponseIntercept, ProxyState,
};
pub use mitm::ApiRequestLog;
pub use rules::{NetworkRule, NetworkRulesEngine, RuleAction};

/// Default proxy port for API interception (IMPL-PLAN: port 4434)
const DEFAULT_PROXY_PORT: u16 = 4434;

/// Channel capacity for API request events
const EVENT_CHANNEL_CAPACITY: usize = 256;

/// Create the proxy state with an HTTP client, event broadcast channel, and in-memory storage.
///
/// Attempts to load the mkcert CA for CONNECT MITM. If CA cert+key are not found,
/// MITM is disabled and CONNECT tunnels fall back to transparent forwarding.
pub fn create_proxy_state() -> (Arc<ProxyState>, broadcast::Receiver<ApiRequestLog>) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        // Disable auto-decompression so we forward raw bytes 1:1 to the client.
        // The client's accept-encoding is forwarded as-is, and the upstream
        // response (possibly compressed) is passed through transparently.
        .no_gzip()
        .no_deflate()
        .no_brotli()
        .build()
        .expect("failed to create HTTP client");

    let (event_tx, event_rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);

    // Ensure rustls CryptoProvider is installed (needed for TLS MITM + native-certs).
    // Both ring and aws-lc-rs may be compiled in — explicitly pick ring.
    let _ = rustls::crypto::ring::default_provider().install_default();

    // Load CA for CONNECT MITM (optional — graceful degradation)
    let ca = match tls_mitm::CaAuthority::load_from_disk() {
        Ok(ca) => {
            info!("CONNECT MITM enabled (CA loaded)");
            Some(Arc::new(ca))
        }
        Err(e) => {
            tracing::warn!(
                "CONNECT MITM disabled (CA not found: {e}). CONNECT tunnels will be transparent."
            );
            None
        }
    };

    let state = Arc::new(ProxyState {
        client,
        event_tx,
        captured: RwLock::new(VecDeque::new()),
        intercept_modes: RwLock::new(HashMap::new()),
        pending_intercepts: RwLock::new(HashMap::new()),
        pending_response_intercepts: RwLock::new(HashMap::new()),
        pending_images: RwLock::new(HashMap::new()),
        ca,
        network_rules: Arc::new(rules::NetworkRulesEngine::new()),
        proxy_modes: modes::ProxyModeStore::new(),
        inject_store: inject::InjectStore::new(),
        rewrite_store: rewrite::RewriteStore::new(),
        key_store: keys::KeyStore::new(),
    });

    (state, event_rx)
}

/// Build the proxy router
pub fn proxy_router(state: Arc<ProxyState>) -> Router {
    Router::new()
        .route("/{*path}", any(handler::proxy_handler))
        // Fallback catches CONNECT requests (authority-form URI doesn't match /{*path})
        .fallback(handler::connect_handler)
        .with_state(state)
}

/// Start the proxy server on the configured port
pub async fn start_proxy(state: Arc<ProxyState>) -> anyhow::Result<()> {
    let port: u16 = std::env::var("NOAIDE_PROXY_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PROXY_PORT);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let router = proxy_router(state);

    info!(%addr, "api proxy listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await?;

    Ok(())
}
