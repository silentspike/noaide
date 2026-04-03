//! WebSocket relay for proxied connections (e.g. Codex WebSocket over reverse proxy).
//!
//! When a client sends an HTTP Upgrade: websocket request through the reverse proxy,
//! the proxy establishes a WebSocket connection to the upstream and relays frames
//! bidirectionally. Text frames are logged as ApiRequestLog entries with method
//! "WS-OUT" (client→upstream) and "WS-IN" (upstream→client). Binary frames are
//! logged as metadata only (size + opcode).

use std::sync::Arc;
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message as TungMessage;
use tracing::{debug, info};

use super::mitm::{self, ApiRequestLog};

/// Maximum text frame size to log in full (larger frames are truncated in logs)
const MAX_LOG_FRAME_SIZE: usize = 64 * 1024; // 64 KB

/// Relay WebSocket frames between client and upstream, logging text frames.
///
/// Both `client_ws` and `upstream_ws` are already upgraded WebSocket streams.
/// This function runs until either side closes or an error occurs.
pub async fn relay_frames(
    client_ws: axum::extract::ws::WebSocket,
    upstream_ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    session_id: Option<String>,
    url: String,
    state: Arc<super::handler::ProxyState>,
) {
    let (mut upstream_tx, mut upstream_rx) = upstream_ws.split();
    let (mut client_tx, mut client_rx) = client_ws.split();

    let session_for_out = session_id.clone();
    let url_for_out = url.clone();
    let state_for_out = state.clone();

    // Client → Upstream (WS-OUT)
    let client_to_upstream = async {
        while let Some(msg_result) = client_rx.next().await {
            let msg = match msg_result {
                Ok(m) => m,
                Err(e) => {
                    debug!(error = %e, "client WS recv error");
                    break;
                }
            };

            match msg {
                axum::extract::ws::Message::Text(text) => {
                    // Log text frame as WS-OUT
                    log_ws_frame(
                        &session_for_out,
                        &url_for_out,
                        "WS-OUT",
                        Some(text.as_ref()),
                        text.len(),
                        &state_for_out,
                    )
                    .await;

                    if upstream_tx
                        .send(TungMessage::Text(text.as_str().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                axum::extract::ws::Message::Binary(data) => {
                    // Log binary frame as metadata only
                    log_ws_frame(
                        &session_for_out,
                        &url_for_out,
                        "WS-OUT",
                        None,
                        data.len(),
                        &state_for_out,
                    )
                    .await;

                    if upstream_tx
                        .send(TungMessage::Binary(data))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                axum::extract::ws::Message::Ping(data) => {
                    if upstream_tx
                        .send(TungMessage::Ping(data))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                axum::extract::ws::Message::Pong(data) => {
                    if upstream_tx
                        .send(TungMessage::Pong(data))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                axum::extract::ws::Message::Close(frame) => {
                    let close_frame = frame.map(|f| {
                        tokio_tungstenite::tungstenite::protocol::CloseFrame {
                            code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::from(f.code),
                            reason: f.reason.to_string().into(),
                        }
                    });
                    let _ = upstream_tx.send(TungMessage::Close(close_frame)).await;
                    break;
                }
            }
        }
    };

    // Upstream → Client (WS-IN)
    let upstream_to_client = async {
        while let Some(msg_result) = upstream_rx.next().await {
            let msg = match msg_result {
                Ok(m) => m,
                Err(e) => {
                    debug!(error = %e, "upstream WS recv error");
                    break;
                }
            };

            match msg {
                TungMessage::Text(text) => {
                    // Log text frame as WS-IN
                    log_ws_frame(
                        &session_id,
                        &url,
                        "WS-IN",
                        Some(text.as_ref()),
                        text.len(),
                        &state,
                    )
                    .await;

                    if client_tx
                        .send(axum::extract::ws::Message::Text(text.to_string().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                TungMessage::Binary(data) => {
                    // Log binary frame as metadata only
                    log_ws_frame(&session_id, &url, "WS-IN", None, data.len(), &state).await;

                    if client_tx
                        .send(axum::extract::ws::Message::Binary(data))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                TungMessage::Ping(data) => {
                    if client_tx
                        .send(axum::extract::ws::Message::Ping(data))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                TungMessage::Pong(data) => {
                    if client_tx
                        .send(axum::extract::ws::Message::Pong(data))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                TungMessage::Close(frame) => {
                    let close_frame = frame.map(|f| axum::extract::ws::CloseFrame {
                        code: f.code.into(),
                        reason: f.reason.to_string().into(),
                    });
                    let _ = client_tx
                        .send(axum::extract::ws::Message::Close(close_frame))
                        .await;
                    break;
                }
                // Frame is a non-standard tungstenite variant — skip
                _ => continue,
            }
        }
    };

    // Run both directions concurrently; stop when either side closes
    tokio::select! {
        _ = client_to_upstream => {}
        _ = upstream_to_client => {}
    }

    info!(url = %url_for_out, "WebSocket relay ended");
}

/// Log a single WebSocket frame as an ApiRequestLog entry.
///
/// Text frames include the (redacted) body content; binary frames log only metadata.
async fn log_ws_frame(
    session_id: &Option<String>,
    url: &str,
    method: &str, // "WS-OUT" or "WS-IN"
    text_body: Option<&str>,
    frame_size: usize,
    state: &super::handler::ProxyState,
) {
    let start = Instant::now();

    let body_str = match text_body {
        Some(text) if text.len() <= MAX_LOG_FRAME_SIZE => mitm::redact(text),
        Some(text) => {
            let truncated = &text[..MAX_LOG_FRAME_SIZE];
            format!(
                "{}... [truncated, {} bytes total]",
                mitm::redact(truncated),
                text.len()
            )
        }
        None => format!("[binary frame, {} bytes]", frame_size),
    };

    let log_entry = ApiRequestLog {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        method: method.to_string(),
        url: mitm::redact(url),
        request_body: if method == "WS-OUT" {
            body_str.clone()
        } else {
            String::new()
        },
        response_body: if method == "WS-IN" {
            body_str.clone()
        } else {
            String::new()
        },
        status_code: 101,
        latency_ms: start.elapsed().as_millis() as u64,
        request_headers: vec![],
        response_headers: vec![],
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
        request_size: if method == "WS-OUT" { frame_size } else { 0 },
        response_size: if method == "WS-IN" { frame_size } else { 0 },
        category: Some("Api".to_string()),
    };

    // Store in captured buffer + broadcast
    {
        let mut captured = state.captured.write().await;
        if captured.len() >= super::handler::MAX_CAPTURED_REQUESTS {
            captured.pop_front();
        }
        captured.push_back(log_entry.clone());
    }
    let _ = state.event_tx.send(log_entry);
}

/// Check if request headers indicate a WebSocket upgrade.
pub fn is_websocket_upgrade(headers: &axum::http::HeaderMap) -> bool {
    let has_upgrade = headers
        .get(axum::http::header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"));

    let has_connection_upgrade = headers
        .get(axum::http::header::CONNECTION)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',')
                .any(|part| part.trim().eq_ignore_ascii_case("upgrade"))
        });

    has_upgrade && has_connection_upgrade
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn detects_websocket_upgrade_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("upgrade", "websocket".parse().unwrap());
        headers.insert("connection", "Upgrade".parse().unwrap());
        assert!(is_websocket_upgrade(&headers));
    }

    #[test]
    fn rejects_missing_upgrade_header() {
        let mut headers = HeaderMap::new();
        headers.insert("connection", "Upgrade".parse().unwrap());
        assert!(!is_websocket_upgrade(&headers));
    }

    #[test]
    fn rejects_non_websocket_upgrade() {
        let mut headers = HeaderMap::new();
        headers.insert("upgrade", "h2c".parse().unwrap());
        headers.insert("connection", "Upgrade".parse().unwrap());
        assert!(!is_websocket_upgrade(&headers));
    }

    #[test]
    fn handles_connection_header_with_multiple_values() {
        let mut headers = HeaderMap::new();
        headers.insert("upgrade", "websocket".parse().unwrap());
        headers.insert("connection", "keep-alive, Upgrade".parse().unwrap());
        assert!(is_websocket_upgrade(&headers));
    }

    #[test]
    fn case_insensitive_websocket() {
        let mut headers = HeaderMap::new();
        headers.insert("upgrade", "WebSocket".parse().unwrap());
        headers.insert("connection", "upgrade".parse().unwrap());
        assert!(is_websocket_upgrade(&headers));
    }

    #[test]
    fn rejects_empty_headers() {
        let headers = HeaderMap::new();
        assert!(!is_websocket_upgrade(&headers));
    }

    #[tokio::test]
    async fn log_ws_frame_text_redacts_keys() {
        use tokio::sync::{RwLock, broadcast};
        use std::collections::{HashMap, VecDeque};

        let (event_tx, _rx) = broadcast::channel(16);
        let state = Arc::new(super::super::handler::ProxyState {
            client: reqwest::Client::new(),
            event_tx,
            captured: RwLock::new(VecDeque::new()),
            intercept_modes: RwLock::new(HashMap::new()),
            pending_intercepts: RwLock::new(HashMap::new()),
            pending_response_intercepts: RwLock::new(HashMap::new()),
            pending_images: RwLock::new(HashMap::new()),
            ca: None,
            network_rules: Arc::new(super::super::rules::NetworkRulesEngine::new()),
            proxy_modes: super::super::modes::ProxyModeStore::new(),
            inject_store: super::super::inject::InjectStore::new(),
            rewrite_store: super::super::rewrite::RewriteStore::new(),
        });

        let session = Some("test-session".to_string());
        let body_with_key = r#"{"key": "sk-ant-api03-secret123"}"#;

        log_ws_frame(&session, "wss://example.com/ws", "WS-OUT", Some(body_with_key), body_with_key.len(), &state).await;

        let captured = state.captured.read().await;
        assert_eq!(captured.len(), 1);
        let entry = &captured[0];
        assert_eq!(entry.method, "WS-OUT");
        assert!(!entry.request_body.contains("sk-ant-"));
        assert!(entry.request_body.contains("[REDACTED]"));
    }

    #[tokio::test]
    async fn log_ws_frame_binary_shows_metadata() {
        use tokio::sync::{RwLock, broadcast};
        use std::collections::{HashMap, VecDeque};

        let (event_tx, _rx) = broadcast::channel(16);
        let state = Arc::new(super::super::handler::ProxyState {
            client: reqwest::Client::new(),
            event_tx,
            captured: RwLock::new(VecDeque::new()),
            intercept_modes: RwLock::new(HashMap::new()),
            pending_intercepts: RwLock::new(HashMap::new()),
            pending_response_intercepts: RwLock::new(HashMap::new()),
            pending_images: RwLock::new(HashMap::new()),
            ca: None,
            network_rules: Arc::new(super::super::rules::NetworkRulesEngine::new()),
            proxy_modes: super::super::modes::ProxyModeStore::new(),
            inject_store: super::super::inject::InjectStore::new(),
            rewrite_store: super::super::rewrite::RewriteStore::new(),
        });

        let session = Some("test-session".to_string());

        log_ws_frame(&session, "wss://example.com/ws", "WS-IN", None, 4096, &state).await;

        let captured = state.captured.read().await;
        assert_eq!(captured.len(), 1);
        let entry = &captured[0];
        assert_eq!(entry.method, "WS-IN");
        assert!(entry.response_body.contains("binary frame"));
        assert!(entry.response_body.contains("4096"));
    }
}
