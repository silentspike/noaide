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
use tracing::{debug, info, warn};

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
                    let outbound = transform_outgoing_text_frame(
                        text.as_ref(),
                        &url_for_out,
                        session_for_out.as_deref(),
                        &state_for_out,
                    );

                    // Log text frame as WS-OUT
                    log_ws_frame(
                        &session_for_out,
                        &url_for_out,
                        "WS-OUT",
                        Some(&outbound),
                        outbound.len(),
                        &state_for_out,
                    )
                    .await;

                    if upstream_tx
                        .send(TungMessage::Text(outbound.into()))
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

                    if upstream_tx.send(TungMessage::Binary(data)).await.is_err() {
                        break;
                    }
                }
                axum::extract::ws::Message::Ping(data) => {
                    if upstream_tx.send(TungMessage::Ping(data)).await.is_err() {
                        break;
                    }
                }
                axum::extract::ws::Message::Pong(data) => {
                    if upstream_tx.send(TungMessage::Pong(data)).await.is_err() {
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

fn transform_outgoing_text_frame(
    text: &str,
    url: &str,
    session_id: Option<&str>,
    state: &super::handler::ProxyState,
) -> String {
    let Some(session_id) = session_id else {
        return text.to_string();
    };

    let Some(provider) = detect_ws_provider(url) else {
        return text.to_string();
    };

    let Ok(mut body_json) = serde_json::from_str::<serde_json::Value>(text) else {
        return text.to_string();
    };

    if body_json.get("type").and_then(|value| value.as_str()) != Some("response.create") {
        return text.to_string();
    }

    let mut modified = false;

    let inject_config = state.inject_store.get(session_id);
    let injection_text = super::inject::build_injection(&inject_config);
    if !injection_text.is_empty()
        && super::inject::inject_into_body(&mut body_json, provider, &injection_text)
    {
        modified = true;
    }

    let rewrite_config = state.rewrite_store.get(session_id);
    if rewrite_config.is_active()
        && super::rewrite::apply_rewrites(&mut body_json, provider, &rewrite_config)
    {
        modified = true;
    }

    if !modified {
        return text.to_string();
    }

    match serde_json::to_string(&body_json) {
        Ok(serialized) => serialized,
        Err(error) => {
            warn!(error = %error, url = %url, "failed to serialize transformed websocket frame");
            text.to_string()
        }
    }
}

fn detect_ws_provider(url: &str) -> Option<super::handler::ApiProvider> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    let path = parsed.path();

    if host == "chatgpt.com" && path.starts_with("/backend-api/") {
        return Some(super::handler::ApiProvider::ChatGPT);
    }

    None
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
    use super::super::handler::ApiProvider;
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
        let state = Arc::new(test_proxy_state());

        let session = Some("test-session".to_string());
        let body_with_key = r#"{"key": "sk-ant-api03-secret123"}"#;

        log_ws_frame(
            &session,
            "wss://example.com/ws",
            "WS-OUT",
            Some(body_with_key),
            body_with_key.len(),
            &state,
        )
        .await;

        let captured = state.captured.read().await;
        assert_eq!(captured.len(), 1);
        let entry = &captured[0];
        assert_eq!(entry.method, "WS-OUT");
        assert!(!entry.request_body.contains("sk-ant-"));
        assert!(entry.request_body.contains("[REDACTED]"));
    }

    #[tokio::test]
    async fn log_ws_frame_binary_shows_metadata() {
        let state = Arc::new(test_proxy_state());

        let session = Some("test-session".to_string());

        log_ws_frame(
            &session,
            "wss://example.com/ws",
            "WS-IN",
            None,
            4096,
            &state,
        )
        .await;

        let captured = state.captured.read().await;
        assert_eq!(captured.len(), 1);
        let entry = &captured[0];
        assert_eq!(entry.method, "WS-IN");
        assert!(entry.response_body.contains("binary frame"));
        assert!(entry.response_body.contains("4096"));
    }

    #[test]
    fn transforms_codex_ws_response_create_with_inject_and_rewrite() {
        let state = test_proxy_state();
        state.inject_store.set(
            "session-1".to_string(),
            super::super::inject::InjectConfig {
                presets: vec![],
                custom_text: Some("ws inject".to_string()),
            },
        );
        state.rewrite_store.set(
            "session-1".to_string(),
            super::super::rewrite::RewriteConfig {
                model_override: Some("gpt-4o".to_string()),
                ..Default::default()
            },
        );

        let original = serde_json::json!({
            "type": "response.create",
            "model": "gpt-5.4",
            "instructions": "existing instructions",
            "input": [{"role": "user", "content": [{"type": "input_text", "text": "hello"}]}],
        });

        let transformed = transform_outgoing_text_frame(
            &serde_json::to_string(&original).unwrap(),
            "wss://chatgpt.com/backend-api/codex/responses",
            Some("session-1"),
            &state,
        );

        let parsed: serde_json::Value = serde_json::from_str(&transformed).unwrap();
        assert_eq!(parsed["model"], "gpt-4o");
        let instructions = parsed["instructions"].as_str().unwrap();
        assert!(instructions.contains("existing instructions"));
        assert!(instructions.contains("ws inject"));
    }

    #[test]
    fn transforms_codex_ws_response_create_with_pure_mode() {
        let state = test_proxy_state();
        state.rewrite_store.set(
            "session-1".to_string(),
            super::super::rewrite::RewriteConfig {
                pure_mode: true,
                ..Default::default()
            },
        );

        let original = serde_json::json!({
            "type": "response.create",
            "model": "gpt-5.4",
            "stream": true,
            "instructions": "existing instructions",
            "tools": [{"type": "function"}],
            "input": [{"role": "user", "content": [{"type": "input_text", "text": "hello"}]}],
        });

        let transformed = transform_outgoing_text_frame(
            &serde_json::to_string(&original).unwrap(),
            "wss://chatgpt.com/backend-api/codex/responses",
            Some("session-1"),
            &state,
        );

        let parsed: serde_json::Value = serde_json::from_str(&transformed).unwrap();
        let obj = parsed.as_object().unwrap();
        assert_eq!(obj.len(), 2);
        assert_eq!(parsed["model"], "gpt-5.4");
        assert!(parsed["input"].is_array());
        assert!(parsed.get("stream").is_none());
        assert!(parsed.get("instructions").is_none());
        assert!(parsed.get("tools").is_none());
    }

    #[test]
    fn leaves_non_response_create_ws_frames_unchanged() {
        let state = test_proxy_state();
        state.inject_store.set(
            "session-1".to_string(),
            super::super::inject::InjectConfig {
                presets: vec![],
                custom_text: Some("ws inject".to_string()),
            },
        );

        let original = serde_json::json!({
            "type": "response.cancel",
            "instructions": "existing instructions",
        });
        let original_text = serde_json::to_string(&original).unwrap();

        let transformed = transform_outgoing_text_frame(
            &original_text,
            "wss://chatgpt.com/backend-api/codex/responses",
            Some("session-1"),
            &state,
        );

        assert_eq!(transformed, original_text);
    }

    #[test]
    fn detects_chatgpt_ws_provider() {
        assert_eq!(
            detect_ws_provider("wss://chatgpt.com/backend-api/codex/responses"),
            Some(ApiProvider::ChatGPT)
        );
        assert_eq!(detect_ws_provider("wss://example.com/ws"), None);
    }

    fn test_proxy_state() -> super::super::handler::ProxyState {
        use std::collections::{HashMap, VecDeque};
        use tokio::sync::{RwLock, broadcast};

        let (event_tx, _rx) = broadcast::channel(16);
        super::super::handler::ProxyState {
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
            key_store: super::super::keys::KeyStore::new(),
        }
    }
}
