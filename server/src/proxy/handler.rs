use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::StreamExt;
use http_body_util::BodyExt;
use tokio::io::AsyncWriteExt as _;
use tokio::sync::{RwLock, broadcast, oneshot};
use tracing::{info, warn};

use super::mitm::{self, ApiRequestLog};

/// Try to decompress a zstd-encoded request body for logging.
/// Codex CLI sends `content-encoding: zstd` on request bodies.
/// Original compressed bytes are still forwarded to upstream unchanged.
fn try_decompress_request(body: &[u8], headers: &[(String, String)]) -> Option<Vec<u8>> {
    let has_zstd = headers
        .iter()
        .any(|(k, v)| k == "content-encoding" && v.contains("zstd"));
    if has_zstd {
        zstd::stream::decode_all(body).ok()
    } else {
        None
    }
}

/// Maximum number of captured requests kept in memory
const MAX_CAPTURED_REQUESTS: usize = 1000;

/// Supported upstream API providers
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiProvider {
    Anthropic,
    OpenAI,
    /// Codex CLI using ChatGPT backend (chatgpt.com/backend-api)
    ChatGPT,
    /// Google Gemini standard API (generativelanguage.googleapis.com)
    Google,
    /// Gemini CLI Code Assist backend (cloudcode-pa.googleapis.com)
    GoogleCodeAssist,
}

impl ApiProvider {
    pub fn base_url(&self) -> &'static str {
        match self {
            ApiProvider::Anthropic => "https://api.anthropic.com",
            // OpenAI SDK sends paths without /v1 prefix (e.g. /models, /responses)
            ApiProvider::OpenAI => "https://api.openai.com/v1",
            // Codex ChatGPT backend — path already includes /backend-api/...
            ApiProvider::ChatGPT => "https://chatgpt.com",
            ApiProvider::Google => "https://generativelanguage.googleapis.com",
            // Gemini CLI uses cloudcode-pa for Code Assist API
            ApiProvider::GoogleCodeAssist => "https://cloudcode-pa.googleapis.com",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            ApiProvider::Anthropic => "anthropic",
            ApiProvider::OpenAI => "openai",
            ApiProvider::ChatGPT => "chatgpt",
            ApiProvider::Google => "google",
            ApiProvider::GoogleCodeAssist => "google-codeassist",
        }
    }
}

/// Detect which upstream API provider to route to based on request headers and path.
///
/// Detection order:
/// 1. `anthropic-version` header → Anthropic
/// 2. Google headers + Code Assist paths (v1internal:, v2beta:) → GoogleCodeAssist
/// 3. Google headers → Google (standard Gemini API)
/// 4. `/backend-api/` path → ChatGPT backend (Codex)
/// 5. Default → OpenAI (standard API)
fn detect_provider(headers: &HeaderMap, path: &str) -> ApiProvider {
    // Anthropic SDK always sends anthropic-version header
    if headers.contains_key("anthropic-version") {
        return ApiProvider::Anthropic;
    }

    // Google: distinguish between standard Gemini API and Code Assist backend.
    // Gemini CLI (Code Assist) sends paths like /v1internal:streamGenerateContent,
    // /v2beta:loadCodeAssist etc. Standard Gemini API uses /v1beta/models/...
    let is_google =
        headers.contains_key("x-goog-api-key") || headers.contains_key("x-goog-api-client");
    if is_google {
        // Code Assist paths use colon-separated RPC style: /v1internal:method
        if path.contains("internal:") || path.contains("beta:") || path.contains("CodeAssist") {
            return ApiProvider::GoogleCodeAssist;
        }
        return ApiProvider::Google;
    }

    // Codex ChatGPT backend uses /backend-api/ path prefix.
    // Note: chatgpt-account-id header is sent on ALL Codex requests (even /models),
    // so we ONLY use the path prefix as the signal. The header alone is unreliable.
    if path.starts_with("/backend-api/") {
        return ApiProvider::ChatGPT;
    }

    // Default to OpenAI (standard API)
    ApiProvider::OpenAI
}

/// Per-session intercept mode: Auto (passthrough) or Manual (hold for user decision).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterceptMode {
    Auto,
    Manual,
}

/// User decision for an intercepted request.
#[derive(Debug)]
pub enum InterceptDecision {
    Forward {
        modified_body: Option<Vec<u8>>,
        modified_headers: Option<Vec<(String, String)>>,
    },
    Drop,
}

/// A request held by the interceptor, waiting for user decision.
pub struct PendingIntercept {
    pub id: String,
    pub session_id: Option<String>,
    pub method: String,
    pub url: String,
    pub provider: ApiProvider,
    pub request_body: Vec<u8>,
    pub request_headers: Vec<(String, String)>,
    pub timestamp: i64,
    pub decision_tx: oneshot::Sender<InterceptDecision>,
}

/// A response held by the interceptor, waiting for user decision before returning to caller.
pub struct PendingResponseIntercept {
    pub id: String,
    pub session_id: Option<String>,
    pub method: String,
    pub url: String,
    pub provider: ApiProvider,
    pub status_code: u16,
    pub response_body: Vec<u8>,
    pub response_headers: Vec<(String, String)>,
    pub timestamp: i64,
    pub decision_tx: oneshot::Sender<InterceptDecision>,
}

/// Shared state for the proxy handler
pub struct ProxyState {
    pub client: reqwest::Client,
    pub event_tx: broadcast::Sender<ApiRequestLog>,
    /// In-memory ring buffer of captured API requests (bounded, oldest dropped first)
    pub captured: RwLock<VecDeque<ApiRequestLog>>,
    /// Per-session intercept mode (default: Auto for unregistered sessions)
    pub intercept_modes: RwLock<HashMap<String, InterceptMode>>,
    /// Pending intercepted requests awaiting user decision via oneshot channel
    pub pending_intercepts: RwLock<HashMap<String, PendingIntercept>>,
    /// Pending intercepted responses awaiting user decision before returning to caller
    pub pending_response_intercepts: RwLock<HashMap<String, PendingResponseIntercept>>,
}

/// Extract session UUID from `/s/{uuid}/...` proxy path prefix.
///
/// Managed sessions set their base URL to `http://localhost:4434/s/{session_uuid}`,
/// so all their API requests arrive with this prefix. The prefix is stripped before
/// forwarding to upstream. The session_id is used for per-session filtering and
/// intercept mode.
///
/// Returns `(session_id, effective_path_without_prefix)`.
fn extract_session_prefix(path: &str) -> (Option<String>, &str) {
    if let Some(after_s) = path.strip_prefix("/s/")
        && let Some(slash_pos) = after_s.find('/')
    {
        let uuid_str = &after_s[..slash_pos];
        // Validate it looks like a UUID (36 chars with hyphens)
        if uuid_str.len() == 36 && uuid_str.chars().filter(|c| *c == '-').count() == 4 {
            return (Some(uuid_str.to_string()), &after_s[slash_pos..]);
        }
    }
    (None, path)
}

/// Main proxy handler — intercepts requests, detects provider, forwards to upstream,
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

    // Extract session ID from /s/{uuid}/... prefix (managed sessions only)
    let path = uri.path();
    let (session_id, effective_path) = extract_session_prefix(path);

    info!(
        request_id = %request_id,
        method = %method,
        raw_path = %path,
        session_id = ?session_id,
        effective_path = %effective_path,
        "proxy handler entered"
    );

    // Detect upstream provider from headers + effective path (without session prefix)
    let provider = detect_provider(&headers, effective_path);
    let base_url = provider.base_url();
    let query = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    let target_url = format!("{base_url}{effective_path}{query}");

    // Collect request body (mutable — intercept gate may replace it)
    let mut request_bytes: Bytes = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            warn!("failed to read request body: {e}");
            return (StatusCode::BAD_REQUEST, "Bad Request").into_response();
        }
    };

    // Collect request headers for logging (mutable — intercept gate may replace them)
    let mut request_headers: Vec<(String, String)> = headers
        .iter()
        .filter(|(name, _)| *name != "host")
        .map(|(name, value)| {
            (
                name.to_string(),
                value.to_str().unwrap_or("[binary]").to_string(),
            )
        })
        .collect();

    // ── Intercept Gate ──────────────────────────────────────────────────
    // If this session's intercept mode is Manual, hold the request and wait
    // for a user decision (Forward/Drop) via the API.
    let should_intercept = if let Some(ref sid) = session_id {
        let modes = state.intercept_modes.read().await;
        modes.get(sid).copied() == Some(InterceptMode::Manual)
    } else {
        false
    };

    info!(
        request_id = %request_id,
        session_id = ?session_id,
        should_intercept = %should_intercept,
        target_url = %target_url,
        "intercept decision"
    );

    if should_intercept {
        let intercept_id = uuid::Uuid::new_v4().to_string();
        let (decision_tx, decision_rx) = oneshot::channel();

        let pending = PendingIntercept {
            id: intercept_id.clone(),
            session_id: session_id.clone(),
            method: method.to_string(),
            url: target_url.clone(),
            provider,
            request_body: request_bytes.to_vec(),
            request_headers: request_headers.clone(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
            decision_tx,
        };

        state
            .pending_intercepts
            .write()
            .await
            .insert(intercept_id.clone(), pending);

        info!(
            intercept_id = %intercept_id,
            session = ?session_id,
            method = %method,
            url = %target_url,
            "request intercepted, awaiting decision"
        );

        // Wait indefinitely for user decision (no timeout — user may need
        // minutes to inspect/edit the request, like in Burp Suite).
        // If the server shuts down, the sender is dropped and we auto-forward.
        // If the CLI client disconnects, Tokio cancels this handler future,
        // dropping decision_rx. The dead PendingIntercept is cleaned up when
        // someone tries to forward/drop it via the API (sender.is_closed() check).
        let decision = match decision_rx.await {
            Ok(decision) => decision,
            Err(_) => {
                // Sender dropped (server shutting down or API cleanup) — forward automatically
                warn!(intercept_id = %intercept_id, "intercept sender dropped, auto-forwarding");
                InterceptDecision::Forward {
                    modified_body: None,
                    modified_headers: None,
                }
            }
        };

        // Remove from pending (may already be removed by timeout branch above)
        state.pending_intercepts.write().await.remove(&intercept_id);

        match decision {
            InterceptDecision::Forward {
                modified_body,
                modified_headers,
            } => {
                if let Some(body) = modified_body {
                    request_bytes = Bytes::from(body);
                }
                if let Some(hdrs) = modified_headers {
                    request_headers = hdrs;
                }
                info!(intercept_id = %intercept_id, "intercepted request forwarded");
            }
            InterceptDecision::Drop => {
                info!(intercept_id = %intercept_id, "intercepted request dropped");
                return (
                    StatusCode::from_u16(499).unwrap_or(StatusCode::BAD_REQUEST),
                    "Request dropped by interceptor",
                )
                    .into_response();
            }
        }
    }

    // ── Build forwarding request ────────────────────────────────────────

    let mut req_builder = state.client.request(method.clone(), &target_url);

    // Forward headers (skip hop-by-hop + accept-encoding + content-length).
    // Stripping accept-encoding lets reqwest handle decompression automatically,
    // giving us cleartext response bodies for logging in the Network Tab.
    // Content-length is stripped so reqwest sets it from the actual body
    // (which may differ from the original after interceptor body modifications).
    for (name, value) in headers.iter() {
        let name_str = name.as_str();
        if name_str == "host"
            || name_str == "connection"
            || name_str == "transfer-encoding"
            || name_str == "accept-encoding"
            || name_str == "content-length"
        {
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
                if name_str == "host"
                    || name_str == "connection"
                    || name_str == "transfer-encoding"
                    || name_str == "accept-encoding"
                    || name_str == "content-length"
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

    // Collect response metadata
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

    // Detect SSE / streaming responses — these must be streamed through,
    // not buffered (buffering blocks until upstream finishes, which may never happen).
    let is_streaming = response_headers.iter().any(|(n, v)| {
        n == "content-type"
            && (v.contains("text/event-stream")
                || v.contains("application/x-ndjson")
                || v.contains("application/stream"))
    });

    if is_streaming {
        // Check if we should intercept this streaming response.
        // In Manual mode, we buffer the ENTIRE SSE stream first, then hold it
        // for user inspection/modification before replaying to the client.
        let should_intercept_stream = if let Some(ref sid) = session_id {
            let modes = state.intercept_modes.read().await;
            modes.get(sid).copied() == Some(InterceptMode::Manual)
        } else {
            false
        };

        if should_intercept_stream {
            // ── INTERCEPT MODE: Buffer entire SSE stream ──────────────────
            // We must consume the full upstream response before presenting it
            // to the user. The CLI client blocks waiting for our response,
            // giving the user unlimited time to inspect/edit.
            let mut collected = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(bytes) => collected.extend_from_slice(&bytes),
                    Err(e) => {
                        warn!("streaming chunk error during intercept buffering: {e}");
                        break;
                    }
                }
            }

            let intercept_id = uuid::Uuid::new_v4().to_string();
            let (decision_tx, decision_rx) = oneshot::channel();

            let pending_resp = PendingResponseIntercept {
                id: intercept_id.clone(),
                session_id: session_id.clone(),
                method: method.to_string(),
                url: target_url.clone(),
                provider,
                status_code: status.as_u16(),
                response_body: collected.clone(),
                response_headers: response_headers.clone(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64,
                decision_tx,
            };

            state
                .pending_response_intercepts
                .write()
                .await
                .insert(intercept_id.clone(), pending_resp);

            info!(
                intercept_id = %intercept_id,
                session = ?session_id,
                status = %status.as_u16(),
                buffered_bytes = collected.len(),
                "streaming response intercepted (fully buffered), awaiting decision"
            );

            let decision = match decision_rx.await {
                Ok(d) => d,
                Err(_) => {
                    warn!(intercept_id = %intercept_id, "streaming response intercept sender dropped, auto-forwarding");
                    InterceptDecision::Forward {
                        modified_body: None,
                        modified_headers: None,
                    }
                }
            };

            state
                .pending_response_intercepts
                .write()
                .await
                .remove(&intercept_id);

            let mut final_body = Bytes::from(collected);
            let mut final_headers = response_headers;

            match decision {
                InterceptDecision::Forward {
                    modified_body,
                    modified_headers,
                } => {
                    if let Some(body) = modified_body {
                        final_body = Bytes::from(body);
                    }
                    if let Some(hdrs) = modified_headers {
                        final_headers = hdrs;
                    }
                    info!(intercept_id = %intercept_id, "intercepted streaming response forwarded");
                }
                InterceptDecision::Drop => {
                    // Cannot truly drop a response — the client is waiting.
                    // Forward unmodified instead (same as non-streaming drop).
                    info!(intercept_id = %intercept_id, "streaming response drop requested, forwarding unmodified");
                }
            }

            // Log the intercepted streaming request
            let log_req_body = try_decompress_request(&request_bytes, &request_headers);
            let log_req_bytes = log_req_body.as_deref().unwrap_or(&request_bytes);
            let log_entry = mitm::build_log(
                request_id,
                session_id,
                method.as_str(),
                &target_url,
                log_req_bytes,
                &request_headers,
                &final_body,
                &final_headers,
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
                provider = provider.label(),
                streaming = true,
                intercepted = true,
                "api proxy request (streaming, intercepted)"
            );

            let status_class = format!("{}xx", status.as_u16() / 100);
            metrics::counter!("proxy_requests_total",
                "method" => log_entry.method.clone(),
                "status_class" => status_class,
                "provider" => provider.label().to_string(),
            )
            .increment(1);
            metrics::histogram!("proxy_latency_ms",
                "method" => log_entry.method.clone(),
                "provider" => provider.label().to_string(),
            )
            .record(log_entry.latency_ms as f64);

            {
                let mut cap = state.captured.write().await;
                if cap.len() >= MAX_CAPTURED_REQUESTS {
                    cap.pop_front();
                }
                cap.push_back(log_entry.clone());
            }
            let _ = state.event_tx.send(log_entry);

            // Replay the buffered SSE data as the response body.
            // The content-type (text/event-stream) is preserved, so the client's
            // SSE parser handles it the same way regardless of chunking.
            let mut builder = Response::builder().status(status);
            for (name, value) in &final_headers {
                if name == "transfer-encoding" || name == "connection" {
                    continue;
                }
                builder = builder.header(name.as_str(), value.as_str());
            }
            return builder.body(Body::from(final_body)).unwrap_or_else(|_| {
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal Error").into_response()
            });
        }

        // ── AUTO MODE: Stream through in real-time (passthrough) ──────────
        let method_str = method.to_string();
        let status_code = status.as_u16();
        let provider_label = provider.label().to_string();
        let req_headers = request_headers.clone();
        let res_headers = response_headers.clone();
        let req_bytes = request_bytes.clone();
        let target = target_url.clone();
        let log_session_id = session_id.clone();

        let (chunk_tx, chunk_rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(64);
        let log_state = state.clone();

        // Background task: read upstream chunks, forward to channel, collect for log
        tokio::spawn(async move {
            let mut collected = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        collected.extend_from_slice(&bytes);
                        if chunk_tx.send(Ok(bytes)).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                    Err(e) => {
                        warn!("streaming chunk error: {e}");
                        let _ = chunk_tx
                            .send(Err(std::io::Error::other(e.to_string())))
                            .await;
                        break;
                    }
                }
            }
            drop(chunk_tx); // Signal stream end

            // Build log from collected data
            let response_bytes = Bytes::from(collected);
            let log_req_body = try_decompress_request(&req_bytes, &req_headers);
            let log_req_bytes = log_req_body.as_deref().unwrap_or(&req_bytes);
            let log_entry = mitm::build_log(
                request_id,
                log_session_id,
                &method_str,
                &target,
                log_req_bytes,
                &req_headers,
                &response_bytes,
                &res_headers,
                status_code,
                start,
            );

            info!(
                method = log_entry.method,
                url = log_entry.url,
                status = log_entry.status_code,
                latency_ms = log_entry.latency_ms,
                req_size = log_entry.request_size,
                res_size = log_entry.response_size,
                provider = provider_label,
                streaming = true,
                "api proxy request (streaming)"
            );

            let status_class = format!("{}xx", status_code / 100);
            metrics::counter!("proxy_requests_total",
                "method" => log_entry.method.clone(),
                "status_class" => status_class,
                "provider" => provider_label.clone(),
            )
            .increment(1);
            metrics::histogram!("proxy_latency_ms",
                "method" => log_entry.method.clone(),
                "provider" => provider_label,
            )
            .record(log_entry.latency_ms as f64);

            {
                let mut cap = log_state.captured.write().await;
                if cap.len() >= MAX_CAPTURED_REQUESTS {
                    cap.pop_front();
                }
                cap.push_back(log_entry.clone());
            }
            let _ = log_state.event_tx.send(log_entry);
        });

        // Build streaming response back to caller
        let body_stream = tokio_stream::wrappers::ReceiverStream::new(chunk_rx);
        let body = Body::from_stream(body_stream);
        let mut builder = Response::builder().status(status);
        for (name, value) in &response_headers {
            if name == "transfer-encoding" || name == "connection" {
                continue;
            }
            builder = builder.header(name.as_str(), value.as_str());
        }
        return builder.body(body).unwrap_or_else(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Error").into_response()
        });
    }

    // Non-streaming: buffer entire response (original path)
    let mut response_bytes: Bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            warn!("failed to read response body: {e}");
            Bytes::new()
        }
    };
    let mut final_response_headers = response_headers;
    let final_status = status;

    // ── Response Intercept Gate ───────────────────────────────────────────
    // Re-check current mode (not the stale `should_intercept` from request start).
    // If the user switched Manual→Auto while the request was in-flight, we must
    // NOT hold the response — otherwise it gets stuck with nobody to forward it.
    // Streaming responses are NOT intercepted (SSE would break).
    let should_intercept_response = if let Some(ref sid) = session_id {
        let modes = state.intercept_modes.read().await;
        modes.get(sid).copied() == Some(InterceptMode::Manual)
    } else {
        false
    };

    if should_intercept_response {
        let intercept_id = uuid::Uuid::new_v4().to_string();
        let (decision_tx, decision_rx) = oneshot::channel();

        let pending_resp = PendingResponseIntercept {
            id: intercept_id.clone(),
            session_id: session_id.clone(),
            method: method.to_string(),
            url: target_url.clone(),
            provider,
            status_code: status.as_u16(),
            response_body: response_bytes.to_vec(),
            response_headers: final_response_headers.clone(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
            decision_tx,
        };

        state
            .pending_response_intercepts
            .write()
            .await
            .insert(intercept_id.clone(), pending_resp);

        info!(
            intercept_id = %intercept_id,
            session = ?session_id,
            status = %status.as_u16(),
            "response intercepted, awaiting decision"
        );

        // Wait indefinitely for user decision on the response (no timeout).
        // Same rationale as request intercept: user needs unlimited time.
        let decision = match decision_rx.await {
            Ok(decision) => decision,
            Err(_) => {
                warn!(intercept_id = %intercept_id, "response intercept sender dropped, auto-forwarding");
                InterceptDecision::Forward {
                    modified_body: None,
                    modified_headers: None,
                }
            }
        };

        state
            .pending_response_intercepts
            .write()
            .await
            .remove(&intercept_id);

        match decision {
            InterceptDecision::Forward {
                modified_body,
                modified_headers,
            } => {
                if let Some(body) = modified_body {
                    response_bytes = Bytes::from(body);
                }
                if let Some(hdrs) = modified_headers {
                    final_response_headers = hdrs;
                }
                info!(intercept_id = %intercept_id, "intercepted response forwarded");
            }
            InterceptDecision::Drop => {
                // Response drop not supported — forward unmodified instead.
                // The request was already sent upstream, dropping the response
                // would only confuse the CLI client.
                info!(intercept_id = %intercept_id, "response drop requested, forwarding unmodified instead");
            }
        }
    }

    // Decompress request body for logging if content-encoding: zstd (Codex)
    let log_req_body = try_decompress_request(&request_bytes, &request_headers);
    let log_req_bytes = log_req_body.as_deref().unwrap_or(&request_bytes);

    // Build redacted log entry (uses potentially modified response)
    let log_entry = mitm::build_log(
        request_id,
        session_id,
        method.as_str(),
        &target_url,
        log_req_bytes,
        &request_headers,
        &response_bytes,
        &final_response_headers,
        final_status.as_u16(),
        start,
    );

    info!(
        method = log_entry.method,
        url = log_entry.url,
        status = log_entry.status_code,
        latency_ms = log_entry.latency_ms,
        req_size = log_entry.request_size,
        res_size = log_entry.response_size,
        provider = provider.label(),
        "api proxy request"
    );

    // Prometheus metrics
    let status_class = format!("{}xx", log_entry.status_code / 100);
    metrics::counter!("proxy_requests_total",
        "method" => log_entry.method.clone(),
        "status_class" => status_class,
        "provider" => provider.label().to_string(),
    )
    .increment(1);
    metrics::histogram!("proxy_latency_ms",
        "method" => log_entry.method.clone(),
        "provider" => provider.label().to_string(),
    )
    .record(log_entry.latency_ms as f64);

    // Store in bounded in-memory buffer (drop oldest if full)
    {
        let mut cap = state.captured.write().await;
        if cap.len() >= MAX_CAPTURED_REQUESTS {
            cap.pop_front();
        }
        cap.push_back(log_entry.clone());
    }

    // Publish event (non-blocking, drop if no receivers)
    let _ = state.event_tx.send(log_entry);

    // Build response back to caller (uses potentially modified status/headers)
    let mut builder = Response::builder().status(final_status);
    for (name, value) in &final_response_headers {
        if name == "transfer-encoding" || name == "connection" {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_str());
    }

    builder
        .body(Body::from(response_bytes))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Internal Error").into_response())
}

/// Handle HTTP CONNECT requests (used by HTTPS_PROXY clients like Codex CLI).
///
/// Establishes a TCP tunnel between the client and the target server.
/// The tunnel is transparent — TLS happens end-to-end, so we cannot inspect
/// the encrypted content. We log metadata: target host, timing, and byte counts.
pub async fn connect_handler(
    State(state): State<Arc<ProxyState>>,
    req: axum::extract::Request,
) -> Response {
    let start = Instant::now();
    let request_id = uuid::Uuid::new_v4().to_string();

    // Extract target host:port from the URI (authority form: "host:port")
    let target_addr = req
        .uri()
        .authority()
        .map(|a| a.to_string())
        .unwrap_or_default();

    if target_addr.is_empty() {
        warn!("CONNECT without target authority");
        return (StatusCode::BAD_REQUEST, "Missing target authority").into_response();
    }

    info!(target = %target_addr, "CONNECT tunnel requested");

    // Connect to the target
    let target_stream = match tokio::net::TcpStream::connect(&target_addr).await {
        Ok(stream) => stream,
        Err(e) => {
            warn!(target = %target_addr, error = %e, "CONNECT: failed to connect to target");
            return (StatusCode::BAD_GATEWAY, "Failed to connect to target").into_response();
        }
    };

    // Upgrade the client connection to raw TCP
    let log_state = state.clone();
    let rid = request_id.clone();
    let addr = target_addr.clone();
    tokio::spawn(async move {
        match hyper::upgrade::on(req).await {
            Ok(upgraded) => {
                // Split both connections for bidirectional forwarding
                let (mut client_read, mut client_write) =
                    tokio::io::split(hyper_util::rt::TokioIo::new(upgraded));
                let (mut target_read, mut target_write) = target_stream.into_split();

                // Forward bytes in both directions, track volume
                let client_to_target = tokio::io::copy(&mut client_read, &mut target_write);
                let target_to_client = tokio::io::copy(&mut target_read, &mut client_write);

                let (c2t, t2c) = tokio::join!(client_to_target, target_to_client);
                let bytes_sent = c2t.unwrap_or(0);
                let bytes_received = t2c.unwrap_or(0);

                // Shut down write halves
                let _ = target_write.shutdown().await;
                let _ = client_write.shutdown().await;

                let latency_ms = start.elapsed().as_millis() as u64;

                info!(
                    target = %addr,
                    latency_ms,
                    bytes_sent,
                    bytes_received,
                    "CONNECT tunnel closed"
                );

                // Log as a captured request for the Network Tab
                // CONNECT tunnels have no session prefix (opaque tunnel, no path available)
                let log_entry = ApiRequestLog {
                    id: rid,
                    session_id: None,
                    method: "CONNECT".to_string(),
                    url: format!("tunnel://{addr}"),
                    status_code: 200,
                    latency_ms,
                    request_size: bytes_sent as usize,
                    response_size: bytes_received as usize,
                    request_body: String::new(),
                    response_body: String::new(),
                    request_headers: vec![],
                    response_headers: vec![],
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64,
                };

                {
                    let mut cap = log_state.captured.write().await;
                    if cap.len() >= MAX_CAPTURED_REQUESTS {
                        cap.pop_front();
                    }
                    cap.push_back(log_entry.clone());
                }
                let _ = log_state.event_tx.send(log_entry);

                metrics::counter!("proxy_requests_total",
                    "method" => "CONNECT",
                    "status_class" => "2xx",
                    "provider" => "tunnel",
                )
                .increment(1);
            }
            Err(e) => {
                warn!(target = %addr, error = %e, "CONNECT: upgrade failed");
            }
        }
    });

    // Return 200 OK to trigger the upgrade
    Response::builder()
        .status(StatusCode::OK)
        .body(Body::empty())
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Internal Error").into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn provider_base_urls_are_valid() {
        for provider in [
            ApiProvider::Anthropic,
            ApiProvider::OpenAI,
            ApiProvider::ChatGPT,
            ApiProvider::Google,
            ApiProvider::GoogleCodeAssist,
        ] {
            assert!(
                provider.base_url().starts_with("https://"),
                "{:?} base URL must use HTTPS",
                provider
            );
        }
        assert!(ApiProvider::Anthropic.base_url().contains("anthropic.com"));
        assert!(ApiProvider::OpenAI.base_url().contains("openai.com"));
        assert!(ApiProvider::ChatGPT.base_url().contains("chatgpt.com"));
        assert!(ApiProvider::Google.base_url().contains("googleapis.com"));
        assert!(
            ApiProvider::GoogleCodeAssist
                .base_url()
                .contains("cloudcode-pa")
        );
    }

    #[test]
    fn detect_anthropic_by_header() {
        let mut headers = HeaderMap::new();
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        assert_eq!(
            detect_provider(&headers, "/v1/messages"),
            ApiProvider::Anthropic
        );
    }

    #[test]
    fn detect_google_by_api_key_header() {
        let mut headers = HeaderMap::new();
        headers.insert("x-goog-api-key", HeaderValue::from_static("AIza-test"));
        assert_eq!(
            detect_provider(&headers, "/v1beta/models"),
            ApiProvider::Google
        );
    }

    #[test]
    fn detect_google_by_client_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-goog-api-client",
            HeaderValue::from_static("genai-js/0.1"),
        );
        assert_eq!(
            detect_provider(&headers, "/v1beta/models"),
            ApiProvider::Google
        );
    }

    #[test]
    fn detect_chatgpt_by_backend_api_path_with_header() {
        let mut headers = HeaderMap::new();
        headers.insert("chatgpt-account-id", HeaderValue::from_static("acct-123"));
        assert_eq!(
            detect_provider(&headers, "/backend-api/ce/chat"),
            ApiProvider::ChatGPT
        );
    }

    #[test]
    fn detect_openai_despite_chatgpt_header() {
        // Codex sends chatgpt-account-id on ALL requests, even /models.
        // Without /backend-api/ path, it should be treated as OpenAI.
        let mut headers = HeaderMap::new();
        headers.insert("chatgpt-account-id", HeaderValue::from_static("acct-123"));
        assert_eq!(detect_provider(&headers, "/models"), ApiProvider::OpenAI);
    }

    #[test]
    fn detect_chatgpt_by_backend_api_path() {
        let headers = HeaderMap::new();
        assert_eq!(
            detect_provider(&headers, "/backend-api/ce/chat/completions"),
            ApiProvider::ChatGPT
        );
    }

    #[test]
    fn detect_openai_as_default() {
        let headers = HeaderMap::new();
        assert_eq!(
            detect_provider(&headers, "/v1/responses"),
            ApiProvider::OpenAI
        );
    }

    #[test]
    fn detect_openai_with_auth_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer sk-proj-test"),
        );
        assert_eq!(
            detect_provider(&headers, "/v1/responses"),
            ApiProvider::OpenAI
        );
    }

    #[test]
    fn detect_google_codeassist_by_internal_path() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-goog-api-client",
            HeaderValue::from_static("gl-node/22.15"),
        );
        assert_eq!(
            detect_provider(&headers, "/v1internal:loadCodeAssist"),
            ApiProvider::GoogleCodeAssist
        );
    }

    #[test]
    fn detect_google_codeassist_by_beta_colon_path() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-goog-api-client",
            HeaderValue::from_static("gl-node/22.15"),
        );
        assert_eq!(
            detect_provider(&headers, "/v2beta:streamGenerateContent"),
            ApiProvider::GoogleCodeAssist
        );
    }

    #[test]
    fn detect_standard_google_api() {
        let mut headers = HeaderMap::new();
        headers.insert("x-goog-api-key", HeaderValue::from_static("AIza-test"));
        assert_eq!(
            detect_provider(&headers, "/v1beta/models/gemini-pro"),
            ApiProvider::Google
        );
    }

    #[tokio::test]
    async fn capture_stores_in_memory() {
        let (state, _rx) = crate::proxy::create_proxy_state();
        assert!(state.captured.read().await.is_empty());

        let log = crate::proxy::mitm::build_log(
            "test-id".into(),
            None,
            "POST",
            "https://api.anthropic.com/v1/messages",
            b"{}",
            &[],
            b"{\"ok\":true}",
            &[],
            200,
            std::time::Instant::now(),
        );
        state.captured.write().await.push_back(log);

        let cap = state.captured.read().await;
        assert_eq!(cap.len(), 1);
        assert_eq!(cap[0].method, "POST");
        assert_eq!(cap[0].status_code, 200);
        assert!(cap[0].url.contains("api.anthropic.com"));
    }

    #[tokio::test]
    async fn capture_bounded_at_max() {
        let (state, _rx) = crate::proxy::create_proxy_state();

        for i in 0..MAX_CAPTURED_REQUESTS + 10 {
            let log = crate::proxy::mitm::build_log(
                format!("req-{i}"),
                None,
                "GET",
                "https://api.anthropic.com/v1/test",
                b"",
                &[],
                b"",
                &[],
                200,
                std::time::Instant::now(),
            );
            let mut cap = state.captured.write().await;
            if cap.len() >= MAX_CAPTURED_REQUESTS {
                cap.pop_front();
            }
            cap.push_back(log);
        }

        let cap = state.captured.read().await;
        assert_eq!(cap.len(), MAX_CAPTURED_REQUESTS);
        assert_eq!(cap[0].id, "req-10");
    }

    #[test]
    fn extract_session_prefix_valid_uuid() {
        let (sid, path) =
            extract_session_prefix("/s/550e8400-e29b-41d4-a716-446655440000/v1/messages");
        assert_eq!(sid.unwrap(), "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(path, "/v1/messages");
    }

    #[test]
    fn extract_session_prefix_no_prefix() {
        let (sid, path) = extract_session_prefix("/v1/messages");
        assert!(sid.is_none());
        assert_eq!(path, "/v1/messages");
    }

    #[test]
    fn extract_session_prefix_invalid_uuid_length() {
        let (sid, path) = extract_session_prefix("/s/too-short/v1/messages");
        assert!(sid.is_none());
        assert_eq!(path, "/s/too-short/v1/messages");
    }

    #[test]
    fn extract_session_prefix_nested_path() {
        let (sid, path) = extract_session_prefix(
            "/s/550e8400-e29b-41d4-a716-446655440000/backend-api/codex/responses",
        );
        assert_eq!(sid.unwrap(), "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(path, "/backend-api/codex/responses");
    }

    #[test]
    fn intercept_mode_serde_roundtrip() {
        let auto = serde_json::to_string(&InterceptMode::Auto).unwrap();
        assert_eq!(auto, "\"auto\"");
        let manual: InterceptMode = serde_json::from_str("\"manual\"").unwrap();
        assert_eq!(manual, InterceptMode::Manual);
    }
}
