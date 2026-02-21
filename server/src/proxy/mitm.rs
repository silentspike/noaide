use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// Regex patterns for API key redaction
static BEARER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Bearer\s+[A-Za-z0-9_\-]+").unwrap());
static SK_ANT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"sk-ant-[A-Za-z0-9_\-]+").unwrap());

/// Redact all API keys from a string
pub fn redact(input: &str) -> String {
    let result = BEARER_RE.replace_all(input, "Bearer [REDACTED]");
    SK_ANT_RE.replace_all(&result, "[REDACTED]").into_owned()
}

/// Logged API request record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequestLog {
    pub id: String,
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
}

/// Builds a redacted log entry from request/response data
#[allow(clippy::too_many_arguments)]
pub fn build_log(
    id: String,
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
}
