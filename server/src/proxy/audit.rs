//! Audit log + cost tracking — token extraction from SSE responses, cost calculation,
//! append-only JSONL writer, query with filters, CSV/JSON export.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use tracing::warn;

/// Audit log entry with token usage and cost.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub session_id: Option<String>,
    pub method: String,
    pub url: String,
    pub model: String,
    pub provider: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub cost_usd: f64,
    pub timestamp: i64,
    pub latency_ms: u64,
}

/// Model pricing table (per 1M tokens).
struct ModelPrice {
    input: f64,
    output: f64,
}

fn model_price(model: &str) -> ModelPrice {
    // Match on model name prefixes
    if model.contains("opus") {
        ModelPrice {
            input: 15.0,
            output: 75.0,
        }
    } else if model.contains("sonnet") {
        ModelPrice {
            input: 3.0,
            output: 15.0,
        }
    } else if model.contains("haiku") {
        ModelPrice {
            input: 0.25,
            output: 1.25,
        }
    } else if model.contains("gpt-4o") {
        ModelPrice {
            input: 2.5,
            output: 10.0,
        }
    } else if model.contains("gpt-4") {
        ModelPrice {
            input: 10.0,
            output: 30.0,
        }
    } else if model.contains("gemini") && model.contains("pro") {
        ModelPrice {
            input: 1.25,
            output: 5.0,
        }
    } else if model.contains("gemini") && model.contains("flash") {
        ModelPrice {
            input: 0.075,
            output: 0.3,
        }
    } else {
        // Default: moderate pricing
        ModelPrice {
            input: 3.0,
            output: 15.0,
        }
    }
}

/// Calculate cost in USD from token counts and model.
pub fn calculate_cost(model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
    let price = model_price(model);
    (input_tokens as f64 * price.input + output_tokens as f64 * price.output) / 1_000_000.0
}

/// Extract token usage from an SSE response body.
///
/// Supports Anthropic (usage{}), OpenAI (usage{}), and Gemini (usageMetadata{}).
pub fn extract_tokens(body: &str) -> (String, u64, u64, u64, u64) {
    let mut model = String::new();
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut cache_creation = 0u64;
    let mut cache_read = 0u64;

    for line in body.lines() {
        let data = match line.strip_prefix("data: ") {
            Some(d) if d != "[DONE]" => d,
            _ => {
                // Also try non-SSE JSON response
                if line.starts_with('{') {
                    line
                } else {
                    continue;
                }
            }
        };

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
            // Anthropic: message_start has model + usage
            if json.get("type").and_then(|t| t.as_str()) == Some("message_start")
                && let Some(msg) = json.get("message") {
                    if let Some(m) = msg.get("model").and_then(|m| m.as_str()) {
                        model = m.to_string();
                    }
                    if let Some(usage) = msg.get("usage") {
                        input_tokens = usage
                            .get("input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        cache_creation = usage
                            .get("cache_creation_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        cache_read = usage
                            .get("cache_read_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                    }
                }

            // Anthropic: message_delta has output usage
            if json.get("type").and_then(|t| t.as_str()) == Some("message_delta")
                && let Some(usage) = json.get("usage") {
                    output_tokens = usage
                        .get("output_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(output_tokens);
                }

            // OpenAI: usage in final chunk
            if let Some(usage) = json.get("usage") {
                if let Some(pt) = usage.get("prompt_tokens").and_then(|v| v.as_u64()) {
                    input_tokens = pt;
                }
                if let Some(ct) = usage.get("completion_tokens").and_then(|v| v.as_u64()) {
                    output_tokens = ct;
                }
                if let Some(m) = json.get("model").and_then(|m| m.as_str())
                    && model.is_empty() {
                        model = m.to_string();
                    }
            }

            // Gemini: usageMetadata
            if let Some(meta) = json.get("usageMetadata") {
                input_tokens = meta
                    .get("promptTokenCount")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(input_tokens);
                output_tokens = meta
                    .get("candidatesTokenCount")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(output_tokens);
                if let Some(m) = json.get("modelVersion").and_then(|m| m.as_str()) {
                    model = m.to_string();
                }
            }
        }
    }

    (
        model,
        input_tokens,
        output_tokens,
        cache_creation,
        cache_read,
    )
}

/// Audit log file path.
fn audit_log_path() -> PathBuf {
    PathBuf::from("/data/noaide/audit-log.jsonl")
}

/// Append an audit entry to the JSONL log file.
pub fn append_entry(entry: &AuditEntry) {
    let path = audit_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(mut file) => {
            if let Ok(json) = serde_json::to_string(entry) {
                let _ = writeln!(file, "{json}");
            }
        }
        Err(e) => {
            warn!(error = %e, "failed to write audit log");
        }
    }
}

/// Query audit entries with optional filters.
pub fn query_entries(
    session_id: Option<&str>,
    model: Option<&str>,
    limit: usize,
) -> Vec<AuditEntry> {
    let path = audit_log_path();
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut entries: Vec<AuditEntry> = content
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .filter(|e: &AuditEntry| {
            if let Some(sid) = session_id
                && e.session_id.as_deref() != Some(sid) {
                    return false;
                }
            if let Some(m) = model
                && !e.model.contains(m) {
                    return false;
                }
            true
        })
        .collect();

    // Most recent first
    entries.reverse();
    entries.truncate(limit);
    entries
}

/// Export entries as CSV string.
pub fn export_csv(entries: &[AuditEntry]) -> String {
    let mut csv = String::from(
        "timestamp,session_id,model,provider,input_tokens,output_tokens,cache_creation,cache_read,cost_usd,latency_ms,method,url\n",
    );
    for e in entries {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{:.6},{},{},{}\n",
            e.timestamp,
            e.session_id.as_deref().unwrap_or(""),
            e.model,
            e.provider,
            e.input_tokens,
            e.output_tokens,
            e.cache_creation_tokens,
            e.cache_read_tokens,
            e.cost_usd,
            e.latency_ms,
            e.method,
            e.url,
        ));
    }
    csv
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_anthropic_tokens() {
        let body = r#"event: message_start
data: {"type":"message_start","message":{"model":"claude-opus-4-6","usage":{"input_tokens":1500,"cache_creation_input_tokens":100,"cache_read_input_tokens":50}}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":500}}

"#;
        let (model, input, output, cache_creation, cache_read) = extract_tokens(body);
        assert_eq!(model, "claude-opus-4-6");
        assert_eq!(input, 1500);
        assert_eq!(output, 500);
        assert_eq!(cache_creation, 100);
        assert_eq!(cache_read, 50);
    }

    #[test]
    fn extract_openai_tokens() {
        let body = r#"data: {"choices":[],"usage":{"prompt_tokens":200,"completion_tokens":300},"model":"gpt-4o"}
data: [DONE]
"#;
        let (model, input, output, _, _) = extract_tokens(body);
        assert_eq!(model, "gpt-4o");
        assert_eq!(input, 200);
        assert_eq!(output, 300);
    }

    #[test]
    fn extract_gemini_tokens() {
        let body = r#"data: {"candidates":[],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":200},"modelVersion":"gemini-2.0-flash"}
"#;
        let (model, input, output, _, _) = extract_tokens(body);
        assert_eq!(model, "gemini-2.0-flash");
        assert_eq!(input, 100);
        assert_eq!(output, 200);
    }

    #[test]
    fn calculate_cost_opus() {
        let cost = calculate_cost("claude-opus-4-6", 1000, 500);
        // 1000 * 15/1M + 500 * 75/1M = 0.015 + 0.0375 = 0.0525
        assert!((cost - 0.0525).abs() < 0.001);
    }

    #[test]
    fn calculate_cost_haiku() {
        let cost = calculate_cost("claude-haiku-4-5", 10000, 5000);
        // 10000 * 0.25/1M + 5000 * 1.25/1M = 0.0025 + 0.00625 = 0.00875
        assert!((cost - 0.00875).abs() < 0.001);
    }

    #[test]
    fn csv_export_format() {
        let entries = vec![AuditEntry {
            id: "test-1".to_string(),
            session_id: Some("session-1".to_string()),
            method: "POST".to_string(),
            url: "https://api.anthropic.com/v1/messages".to_string(),
            model: "claude-opus-4-6".to_string(),
            provider: "anthropic".to_string(),
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            cost_usd: 0.0525,
            timestamp: 1712345678000,
            latency_ms: 250,
        }];
        let csv = export_csv(&entries);
        assert!(csv.starts_with("timestamp,session_id,model"));
        assert!(csv.contains("1712345678000"));
        assert!(csv.contains("claude-opus-4-6"));
        assert!(csv.contains("0.052500"));
    }

    #[test]
    fn entry_serde_roundtrip() {
        let entry = AuditEntry {
            id: "e1".to_string(),
            session_id: None,
            method: "POST".to_string(),
            url: "test".to_string(),
            model: "test-model".to_string(),
            provider: "test".to_string(),
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_tokens: 10,
            cache_read_tokens: 5,
            cost_usd: 0.01,
            timestamp: 0,
            latency_ms: 100,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: AuditEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.model, "test-model");
        assert_eq!(parsed.input_tokens, 100);
    }
}
