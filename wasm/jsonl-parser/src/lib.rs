use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawEntry {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    uuid: String,
    #[serde(default)]
    parent_uuid: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    is_sidechain: Option<bool>,
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    message: Option<serde_json::Value>,
    // Flatten remaining fields
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParsedMessage {
    uuid: String,
    message_type: String,
    role: Option<String>,
    content: Vec<ContentBlock>,
    timestamp: Option<String>,
    model: Option<String>,
    stop_reason: Option<String>,
    cost_usd: Option<f64>,
    duration_ms: Option<u64>,
    is_sidechain: Option<bool>,
    parent_uuid: Option<String>,
    agent_id: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
    Thinking {
        thinking: String,
    },
    Image {
        media_type: String,
    },
}

fn extract_content_blocks(content: &serde_json::Value) -> Vec<ContentBlock> {
    match content {
        serde_json::Value::String(s) => vec![ContentBlock::Text { text: s.clone() }],
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|block| {
                let block_type = block.get("type")?.as_str()?;
                match block_type {
                    "text" => Some(ContentBlock::Text {
                        text: block.get("text")?.as_str()?.to_string(),
                    }),
                    "tool_use" => Some(ContentBlock::ToolUse {
                        id: block
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        name: block
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        input: block
                            .get("input")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null),
                    }),
                    "tool_result" => {
                        let content_str = match block.get("content") {
                            Some(serde_json::Value::String(s)) => s.clone(),
                            Some(serde_json::Value::Array(arr)) => arr
                                .iter()
                                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                                .collect::<Vec<_>>()
                                .join("\n"),
                            _ => String::new(),
                        };
                        Some(ContentBlock::ToolResult {
                            tool_use_id: block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            content: content_str,
                            is_error: block
                                .get("is_error")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false),
                        })
                    }
                    "thinking" => Some(ContentBlock::Thinking {
                        thinking: block
                            .get("thinking")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    }),
                    "image" => Some(ContentBlock::Image {
                        media_type: block
                            .get("source")
                            .and_then(|s| s.get("media_type"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("image/png")
                            .to_string(),
                    }),
                    _ => Some(ContentBlock::Text {
                        text: format!("[{block_type}]"),
                    }),
                }
            })
            .collect(),
        _ => vec![],
    }
}

fn entry_to_message(entry: RawEntry) -> ParsedMessage {
    let message = entry.message.as_ref();

    let role = message
        .and_then(|m| m.get("role"))
        .and_then(|r| r.as_str())
        .map(String::from)
        .or_else(|| match entry.r#type.as_str() {
            "human" => Some("user".to_string()),
            "assistant" => Some("assistant".to_string()),
            "system" => Some("system".to_string()),
            _ => None,
        });

    let content = message
        .and_then(|m| m.get("content"))
        .map(extract_content_blocks)
        .unwrap_or_default();

    let model = message
        .and_then(|m| m.get("model"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let stop_reason = message
        .and_then(|m| m.get("stop_reason"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let usage = message.and_then(|m| m.get("usage"));
    let input_tokens = usage
        .and_then(|u| u.get("input_tokens"))
        .and_then(|v| v.as_u64());
    let output_tokens = usage
        .and_then(|u| u.get("output_tokens"))
        .and_then(|v| v.as_u64());

    let cost_usd = entry
        .extra
        .get("costUSD")
        .and_then(|v| v.as_f64())
        .or_else(|| entry.extra.get("cost_usd").and_then(|v| v.as_f64()));
    let duration_ms = entry
        .extra
        .get("durationMs")
        .and_then(|v| v.as_u64())
        .or_else(|| entry.extra.get("duration_ms").and_then(|v| v.as_u64()));

    ParsedMessage {
        uuid: entry.uuid,
        message_type: entry.r#type,
        role,
        content,
        timestamp: entry.timestamp,
        model,
        stop_reason,
        cost_usd,
        duration_ms,
        is_sidechain: entry.is_sidechain,
        parent_uuid: entry.parent_uuid,
        agent_id: entry.agent_id,
        input_tokens,
        output_tokens,
    }
}

#[wasm_bindgen]
pub fn parse_line(line: &str) -> Result<JsValue, JsError> {
    let entry: RawEntry = serde_json::from_str(line).map_err(|e| JsError::new(&e.to_string()))?;
    let msg = entry_to_message(entry);
    serde_wasm_bindgen::to_value(&msg).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn parse_jsonl(input: &str) -> Result<JsValue, JsError> {
    let mut messages = Vec::new();

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<RawEntry>(trimmed) {
            Ok(entry) => messages.push(entry_to_message(entry)),
            Err(_) => continue, // Skip malformed lines
        }
    }

    serde_wasm_bindgen::to_value(&messages).map_err(|e| JsError::new(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_assistant_message() {
        let line = r#"{"type":"assistant","uuid":"abc-123","message":{"role":"assistant","content":[{"type":"text","text":"Hello"}],"model":"claude-3","stop_reason":"end_turn","usage":{"input_tokens":100,"output_tokens":50}}}"#;
        let entry: RawEntry = serde_json::from_str(line).unwrap();
        let msg = entry_to_message(entry);
        assert_eq!(msg.message_type, "assistant");
        assert_eq!(msg.role.as_deref(), Some("assistant"));
        assert_eq!(msg.content.len(), 1);
        assert_eq!(msg.input_tokens, Some(100));
        assert_eq!(msg.output_tokens, Some(50));
    }

    #[test]
    fn parse_tool_use() {
        let line = r#"{"type":"assistant","uuid":"xyz","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool_1","name":"Read","input":{"file_path":"/tmp/test.rs"}}]}}"#;
        let entry: RawEntry = serde_json::from_str(line).unwrap();
        let msg = entry_to_message(entry);
        assert_eq!(msg.content.len(), 1);
        match &msg.content[0] {
            ContentBlock::ToolUse { name, .. } => assert_eq!(name, "Read"),
            _ => panic!("expected ToolUse"),
        }
    }

    #[test]
    fn parse_malformed_lines_skipped() {
        let input = "not json\n{\"type\":\"human\",\"uuid\":\"1\"}\n{broken\n";
        let mut count = 0;
        for line in input.lines() {
            if serde_json::from_str::<RawEntry>(line.trim()).is_ok() {
                count += 1;
            }
        }
        assert_eq!(count, 1);
    }
}
