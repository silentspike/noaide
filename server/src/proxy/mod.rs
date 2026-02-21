pub mod handler;
pub mod mitm;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use axum::routing::any;
use tokio::sync::broadcast;
use tracing::info;

pub use handler::ProxyState;
pub use mitm::ApiRequestLog;

/// Default proxy port matching NOAIDE_HTTP_PORT
const DEFAULT_PROXY_PORT: u16 = 8080;

/// Channel capacity for API request events
const EVENT_CHANNEL_CAPACITY: usize = 256;

/// Create the proxy state with an HTTP client and event broadcast channel
pub fn create_proxy_state() -> (Arc<ProxyState>, broadcast::Receiver<ApiRequestLog>) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .expect("failed to create HTTP client");

    let (event_tx, event_rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);

    let state = Arc::new(ProxyState { client, event_tx });

    (state, event_rx)
}

/// Build the proxy router
pub fn proxy_router(state: Arc<ProxyState>) -> Router {
    Router::new()
        .route("/{*path}", any(handler::proxy_handler))
        .with_state(state)
}

/// Start the proxy server on the configured port
pub async fn start_proxy(state: Arc<ProxyState>) -> anyhow::Result<()> {
    let port: u16 = std::env::var("NOAIDE_HTTP_PORT")
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
