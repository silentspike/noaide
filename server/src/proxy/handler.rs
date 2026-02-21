use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use http_body_util::BodyExt;
use tokio::sync::broadcast;
use tracing::{info, warn};

use super::mitm::{self, ApiRequestLog};

const ANTHROPIC_API_BASE: &str = "https://api.anthropic.com";

/// Shared state for the proxy handler
#[derive(Clone)]
pub struct ProxyState {
    pub client: reqwest::Client,
    pub event_tx: broadcast::Sender<ApiRequestLog>,
}

/// Main proxy handler — intercepts requests, forwards to Anthropic API,
/// logs redacted request/response, and publishes events
pub async fn proxy_handler(
    State(state): State<Arc<ProxyState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let start = Instant::now();
    let request_id = uuid::Uuid::new_v4().to_string();

    // Build target URL — only forward to api.anthropic.com
    let path = uri.path();
    let query = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    let target_url = format!("{ANTHROPIC_API_BASE}{path}{query}");

    // Collect request body
    let request_bytes = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            warn!("failed to read request body: {e}");
            return (StatusCode::BAD_REQUEST, "Bad Request").into_response();
        }
    };

    // Collect request headers for logging
    let request_headers: Vec<(String, String)> = headers
        .iter()
        .filter(|(name, _)| *name != "host")
        .map(|(name, value)| {
            (
                name.to_string(),
                value.to_str().unwrap_or("[binary]").to_string(),
            )
        })
        .collect();

    // Build forwarding request
    let mut req_builder = state.client.request(method.clone(), &target_url);

    // Forward headers (skip host, connection)
    for (name, value) in headers.iter() {
        let name_str = name.as_str();
        if name_str == "host" || name_str == "connection" || name_str == "transfer-encoding" {
            continue;
        }
        req_builder = req_builder.header(name.clone(), value.clone());
    }

    if !request_bytes.is_empty() {
        req_builder = req_builder.body(request_bytes.to_vec());
    }

    // Forward request with retry on connection error
    let response = match req_builder.send().await {
        Ok(resp) => resp,
        Err(e) if e.is_connect() => {
            // Retry once on connection error
            warn!("upstream connection failed, retrying: {e}");
            let mut retry_builder = state.client.request(method.clone(), &target_url);
            for (name, value) in headers.iter() {
                let name_str = name.as_str();
                if name_str == "host" || name_str == "connection" || name_str == "transfer-encoding"
                {
                    continue;
                }
                retry_builder = retry_builder.header(name.clone(), value.clone());
            }
            if !request_bytes.is_empty() {
                retry_builder = retry_builder.body(request_bytes.to_vec());
            }
            match retry_builder.send().await {
                Ok(resp) => resp,
                Err(e) => {
                    warn!("upstream retry failed: {e}");
                    return (StatusCode::BAD_GATEWAY, "Bad Gateway").into_response();
                }
            }
        }
        Err(e) if e.is_timeout() => {
            warn!("upstream timeout: {e}");
            return (StatusCode::GATEWAY_TIMEOUT, "Gateway Timeout").into_response();
        }
        Err(e) => {
            warn!("proxy error: {e}");
            return (StatusCode::BAD_GATEWAY, "Bad Gateway").into_response();
        }
    };

    // Collect response
    let status = response.status();
    let response_headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.to_string(),
                value.to_str().unwrap_or("[binary]").to_string(),
            )
        })
        .collect();

    let response_bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            warn!("failed to read response body: {e}");
            Bytes::new()
        }
    };

    // Build redacted log entry
    let log_entry = mitm::build_log(
        request_id,
        method.as_str(),
        &target_url,
        &request_bytes,
        &request_headers,
        &response_bytes,
        &response_headers,
        status.as_u16(),
        start,
    );

    info!(
        method = log_entry.method,
        url = log_entry.url,
        status = log_entry.status_code,
        latency_ms = log_entry.latency_ms,
        req_size = log_entry.request_size,
        res_size = log_entry.response_size,
        "api proxy request"
    );

    // Publish event (non-blocking, drop if no receivers)
    let _ = state.event_tx.send(log_entry);

    // Build response back to caller
    let mut builder = Response::builder().status(status);
    for (name, value) in &response_headers {
        if name == "transfer-encoding" || name == "connection" {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_str());
    }

    builder
        .body(Body::from(response_bytes))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Internal Error").into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_api_base_is_valid() {
        assert!(ANTHROPIC_API_BASE.starts_with("https://"));
        assert!(ANTHROPIC_API_BASE.contains("api.anthropic.com"));
    }
}
