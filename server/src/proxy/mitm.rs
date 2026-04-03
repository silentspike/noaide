use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// Regex patterns for API key redaction (all providers)
static BEARER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Bearer\s+[A-Za-z0-9_\-]+").unwrap());
/// Anthropic keys: sk-ant-api03-...
static SK_ANT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"sk-ant-[A-Za-z0-9_\-]+").unwrap());
/// OpenAI keys: sk-proj-..., sk-... (but not sk-ant which is handled above)
static SK_OPENAI_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"sk-proj-[A-Za-z0-9_\-]+").unwrap());
/// Google API keys: AIza...
static GOOGLE_KEY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"AIza[A-Za-z0-9_\-]{30,}").unwrap());

/// Redact all API keys from a string (supports Anthropic, OpenAI, Google)
pub fn redact(input: &str) -> String {
    let result = BEARER_RE.replace_all(input, "Bearer [REDACTED]");
    let result = SK_ANT_RE.replace_all(&result, "[REDACTED]");
    let result = SK_OPENAI_RE.replace_all(&result, "[REDACTED]");
    GOOGLE_KEY_RE
        .replace_all(&result, "[REDACTED]")
        .into_owned()
}

/// Logged API request record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequestLog {
    pub id: String,
    /// Session UUID that originated this request (extracted from /s/{uuid}/ proxy path prefix).
    /// None for observed sessions or CONNECT tunnels where session attribution is not possible.
    pub session_id: Option<String>,
    pub method: String,
    pub url: String,
    pub request_body: String,
    pub response_body: String,
    pub status_code: u16,
    pub latency_ms: u64,
    pub request_headers: Vec<(String, String)>,
    pub response_headers: Vec<(String, String)>,
    pub timestamp: i64,
    pub request_size: usize,
    pub response_size: usize,
    /// Traffic category (Api, Telemetry, Auth, Update, Git, Unknown).
    /// None for regular reverse-proxy API requests, Some for CONNECT MITM requests.
    pub category: Option<String>,
}

/// Builds a redacted log entry from request/response data
#[allow(clippy::too_many_arguments)]
pub fn build_log(
    id: String,
    session_id: Option<String>,
    method: &str,
    url: &str,
    request_body: &[u8],
    request_headers: &[(String, String)],
    response_body: &[u8],
    response_headers: &[(String, String)],
    status_code: u16,
    start: Instant,
) -> ApiRequestLog {
    let latency = start.elapsed();
    let req_str = String::from_utf8_lossy(request_body);
    let res_str = String::from_utf8_lossy(response_body);

    ApiRequestLog {
        id,
        session_id,
        method: method.to_string(),
        url: redact(url),
        request_body: redact(&req_str),
        response_body: redact(&res_str),
        status_code,
        latency_ms: latency.as_millis() as u64,
        request_headers: request_headers
            .iter()
            .map(|(k, v)| (k.clone(), redact(v)))
            .collect(),
        response_headers: response_headers
            .iter()
            .map(|(k, v)| (k.clone(), redact(v)))
            .collect(),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_millis() as i64,
        request_size: request_body.len(),
        response_size: response_body.len(),
        category: {
            // Classify reverse-proxy requests by extracting host from URL
            let host = url
                .strip_prefix("https://")
                .or_else(|| url.strip_prefix("http://"))
                .unwrap_or(url)
                .split('/')
                .next()
                .unwrap_or("");
            let cat = super::classify::classify_domain(host);
            Some(cat.to_string())
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_token() {
        let input = "Authorization: Bearer sk-ant-api03-abc123";
        let result = redact(input);
        assert!(!result.contains("sk-ant-"));
        assert!(result.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_sk_ant_in_body() {
        let body = r#"{"key": "sk-ant-api03-long-key-here", "data": "hello"}"#;
        let result = redact(body);
        assert!(!result.contains("sk-ant-"));
        assert!(result.contains("[REDACTED]"));
        assert!(result.contains("hello"));
    }

    #[test]
    fn preserves_non_sensitive_content() {
        let input = "Content-Type: application/json";
        assert_eq!(redact(input), input);
    }

    #[test]
    fn redacts_multiple_occurrences() {
        let input = "Bearer abc123 and sk-ant-key1 and sk-ant-key2";
        let result = redact(input);
        assert!(!result.contains("abc123"));
        assert!(!result.contains("sk-ant-key1"));
        assert!(!result.contains("sk-ant-key2"));
    }

    #[test]
    fn redacts_openai_project_key() {
        let input = r#"{"key": "sk-proj-abc123def456ghi789"}"#; // gitleaks:allow
        let result = redact(input);
        assert!(!result.contains("sk-proj-"));
        assert!(result.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_google_api_key() {
        let input = "x-goog-api-key: AIzaSyB1234567890abcdefghijklmnopqrst"; // gitleaks:allow
        let result = redact(input);
        assert!(!result.contains("AIzaSy"));
        assert!(result.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_all_providers_in_one_string() {
        let input = // gitleaks:allow
            "sk-ant-api03-key1 sk-proj-key2 AIzaSyB1234567890abcdefghijklmnopqrst Bearer tok123";
        let result = redact(input);
        assert!(!result.contains("sk-ant-"));
        assert!(!result.contains("sk-proj-"));
        assert!(!result.contains("AIzaSy"));
        assert!(!result.contains("tok123"));
    }

    #[test]
    fn bench_redaction_overhead() {
        let input = "Bearer sk-ant-api03-long-key-value-here and more text with sk-ant-another-key"; // gitleaks:allow
        let start = std::time::Instant::now();
        for _ in 0..1000 {
            let _ = redact(input);
        }
        let elapsed = start.elapsed();
        // 1000 redactions in <500ms → <0.5ms per call → well within 5ms proxy overhead budget
        // (Debug mode is ~10x slower than release; CI may have shared-resource contention)
        assert!(
            elapsed.as_millis() < 500,
            "redaction overhead too high: {elapsed:?}"
        );
    }
}
