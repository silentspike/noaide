//! Gemini CLI JSON parser.
//!
//! Gemini stores sessions as `.json` (NOT `.jsonl`!) files at:
//! `~/.gemini/tmp/{project-hash}/chats/session-{timestamp}-{uuid}.json`
//!
//! Structure: `{ sessionId, projectHash, startTime, lastUpdated, messages[], summary? }`
//! Message types: user, gemini, info, error

use std::path::Path;

use serde::Deserialize;
use tracing::warn;
use uuid::Uuid;

use super::types::{ClaudeMessage, ContentBlock, MessageContent};

/// Top-level Gemini session JSON structure.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiSession {
    #[serde(default)]
    session_id: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    project_hash: Option<String>,
    #[serde(default)]
    start_time: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    last_updated: Option<String>,
    #[serde(default)]
    messages: Vec<GeminiMessage>,
    #[serde(default)]
    summary: Option<String>,
}

/// A single Gemini message.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiMessage {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    content: serde_json::Value,
    /// Gemini thinking/reasoning (can be a string OR an array of objects)
    #[serde(default)]
    thoughts: serde_json::Value,
    /// Token usage
    #[serde(default)]
    tokens: Option<GeminiTokens>,
    /// Model used
    #[serde(default)]
    model: Option<String>,
    /// Tool calls made by gemini
    #[serde(default)]
    tool_calls: Option<Vec<GeminiToolCall>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiTokens {
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiToolCall {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    args: Option<serde_json::Value>,
}

/// Parse a Gemini JSON session file into ClaudeMessage format.
pub async fn parse_gemini_file(path: &Path) -> anyhow::Result<Vec<ClaudeMessage>> {
    let content = tokio::fs::read_to_string(path).await?;
    let session: GeminiSession = serde_json::from_str(&content)?;
    let mut messages = Vec::new();

    // Session start meta message
    if let Some(start) = &session.start_time {
        messages.push(ClaudeMessage {
            uuid: session
                .session_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            message_type: "progress".to_string(),
            role: None,
            content: MessageContent::Text(format!(
                "{{\"type\":\"session_start\",\"cli\":\"gemini\",\"startTime\":\"{start}\"}}"
            )),
            timestamp: Some(start.clone()),
            ..Default::default()
        });
    }

    for msg in &session.messages {
        match msg.msg_type.as_str() {
            "user" => {
                messages.push(gemini_user_message(msg));
            }
            "gemini" => {
                let converted = gemini_assistant_message(msg);
                messages.extend(converted);
            }
            "info" => {
                messages.push(gemini_info_message(msg));
            }
            "error" => {
                messages.push(gemini_error_message(msg));
            }
            other => {
                warn!(msg_type = other, "gemini: unknown message type");
                messages.push(ClaudeMessage {
                    uuid: msg.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string()),
                    message_type: "progress".to_string(),
                    role: None,
                    content: MessageContent::Text(
                        serde_json::to_string(&msg.content).unwrap_or_default(),
                    ),
                    timestamp: msg.timestamp.clone(),
                    ..Default::default()
                });
            }
        }
    }

    // Session summary (if present)
    if let Some(summary) = &session.summary
        && !summary.is_empty()
    {
        messages.push(ClaudeMessage {
            uuid: Uuid::new_v4().to_string(),
            message_type: "summary".to_string(),
            role: None,
            content: MessageContent::Text(summary.clone()),
            timestamp: session.start_time.clone(),
            ..Default::default()
        });
    }

    Ok(messages)
}

/// Convert a Gemini "user" message.
fn gemini_user_message(msg: &GeminiMessage) -> ClaudeMessage {
    let text = extract_text_content(&msg.content);

    ClaudeMessage {
        uuid: msg.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string()),
        message_type: "user".to_string(),
        role: Some("user".to_string()),
        content: MessageContent::Blocks(vec![ContentBlock::Text { text }]),
        timestamp: msg.timestamp.clone(),
        ..Default::default()
    }
}

/// Convert a Gemini "gemini" (assistant) message.
///
/// May produce multiple ClaudeMessages if thinking + content + tool_calls are present.
fn gemini_assistant_message(msg: &GeminiMessage) -> Vec<ClaudeMessage> {
    let mut result = Vec::new();
    let id = msg.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());

    let input_tokens = msg.tokens.as_ref().and_then(|t| t.input_tokens);
    let output_tokens = msg.tokens.as_ref().and_then(|t| t.output_tokens);

    // Thinking block (if present)
    let thinking_text = extract_thoughts(&msg.thoughts);
    if !thinking_text.is_empty() {
        result.push(ClaudeMessage {
            uuid: format!("{id}-thinking"),
            message_type: "assistant".to_string(),
            role: Some("assistant".to_string()),
            content: MessageContent::Blocks(vec![ContentBlock::Thinking {
                thinking: thinking_text,
            }]),
            timestamp: msg.timestamp.clone(),
            model: msg.model.clone(),
            ..Default::default()
        });
    }

    // Main content
    let text = extract_text_content(&msg.content);
    let mut blocks = Vec::new();

    if !text.is_empty() {
        blocks.push(ContentBlock::Text { text });
    }

    // Tool calls
    if let Some(tool_calls) = &msg.tool_calls {
        for tc in tool_calls {
            let name = tc.name.as_deref().unwrap_or("unknown_tool").to_string();
            let input = tc.args.clone().unwrap_or(serde_json::Value::Null);
            blocks.push(ContentBlock::ToolUse {
                id: Uuid::new_v4().to_string(),
                name,
                input,
            });
        }
    }

    if !blocks.is_empty() {
        let has_tools = blocks
            .iter()
            .any(|b| matches!(b, ContentBlock::ToolUse { .. }));

        result.push(ClaudeMessage {
            uuid: id,
            message_type: "assistant".to_string(),
            role: Some("assistant".to_string()),
            content: MessageContent::Blocks(blocks),
            timestamp: msg.timestamp.clone(),
            model: msg.model.clone(),
            stop_reason: if has_tools {
                Some("tool_use".to_string())
            } else {
                Some("end_turn".to_string())
            },
            input_tokens,
            output_tokens,
            ..Default::default()
        });
    }

    result
}

/// Convert a Gemini "info" message (e.g., "Request cancelled.").
fn gemini_info_message(msg: &GeminiMessage) -> ClaudeMessage {
    let text = extract_text_content(&msg.content);

    ClaudeMessage {
        uuid: msg.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string()),
        message_type: "system".to_string(),
        role: Some("system".to_string()),
        content: MessageContent::Text(text),
        timestamp: msg.timestamp.clone(),
        ..Default::default()
    }
}

/// Convert a Gemini "error" message.
fn gemini_error_message(msg: &GeminiMessage) -> ClaudeMessage {
    let text = extract_text_content(&msg.content);

    ClaudeMessage {
        uuid: msg.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string()),
        message_type: "assistant".to_string(),
        role: Some("assistant".to_string()),
        content: MessageContent::Blocks(vec![ContentBlock::Text {
            text: format!("[ERROR] {text}"),
        }]),
        timestamp: msg.timestamp.clone(),
        ..Default::default()
    }
}

/// Extract text from Gemini's flexible content field.
///
/// Content can be:
/// - A string: `"content": "hello"`
/// - An array of objects: `"content": [{"text": "hello"}]`
/// - An object with text: `"content": {"text": "hello"}`
fn extract_text_content(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => {
            let mut parts = Vec::new();
            for item in arr {
                if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                    parts.push(text.to_string());
                } else if let Some(s) = item.as_str() {
                    parts.push(s.to_string());
                }
            }
            parts.join("\n")
        }
        serde_json::Value::Object(obj) => {
            if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
                text.to_string()
            } else {
                serde_json::to_string(content).unwrap_or_default()
            }
        }
        _ => String::new(),
    }
}

/// Extract thinking text from Gemini's flexible thoughts field.
///
/// Thoughts can be:
/// - A string: `"thoughts": "Let me think..."`
/// - An array of objects: `"thoughts": [{"subject": "...", "description": "..."}]`
/// - Null: `"thoughts": null`
fn extract_thoughts(thoughts: &serde_json::Value) -> String {
    match thoughts {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => {
            let mut parts = Vec::new();
            for item in arr {
                // Each item can have subject + description
                let subject = item.get("subject").and_then(|v| v.as_str()).unwrap_or("");
                let desc = item
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !subject.is_empty() && !desc.is_empty() {
                    parts.push(format!("{subject}: {desc}"));
                } else if !desc.is_empty() {
                    parts.push(desc.to_string());
                } else if !subject.is_empty() {
                    parts.push(subject.to_string());
                } else if let Some(text) = item.as_str() {
                    parts.push(text.to_string());
                }
            }
            parts.join("\n")
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_gemini_user_msg() {
        let msg = GeminiMessage {
            id: Some("test-1".to_string()),
            timestamp: Some("2025-11-19T06:17:08.020Z".to_string()),
            msg_type: "user".to_string(),
            content: serde_json::json!([{"text": "hello world"}]),
            thoughts: serde_json::Value::Null,
            tokens: None,
            model: None,
            tool_calls: None,
        };

        let result = gemini_user_message(&msg);
        assert_eq!(result.message_type, "user");
        assert_eq!(result.role, Some("user".to_string()));
    }

    #[test]
    fn parse_gemini_assistant_with_thinking() {
        let msg = GeminiMessage {
            id: Some("test-2".to_string()),
            timestamp: Some("2025-11-19T06:17:10.000Z".to_string()),
            msg_type: "gemini".to_string(),
            content: serde_json::json!("Here is my analysis..."),
            thoughts: serde_json::json!("Let me think about this problem..."),
            tokens: Some(GeminiTokens {
                input_tokens: Some(100),
                output_tokens: Some(50),
            }),
            model: Some("gemini-2.5-pro".to_string()),
            tool_calls: None,
        };

        let results = gemini_assistant_message(&msg);
        assert_eq!(results.len(), 2); // thinking + content
        assert!(matches!(
            &results[0].content,
            MessageContent::Blocks(b) if matches!(&b[0], ContentBlock::Thinking { .. })
        ));
        assert_eq!(results[1].model, Some("gemini-2.5-pro".to_string()));
    }

    #[test]
    fn parse_gemini_error_msg() {
        let msg = GeminiMessage {
            id: Some("test-3".to_string()),
            timestamp: None,
            msg_type: "error".to_string(),
            content: serde_json::json!("API Error: 499"),
            thoughts: serde_json::Value::Null,
            tokens: None,
            model: None,
            tool_calls: None,
        };

        let result = gemini_error_message(&msg);
        assert!(result.content.as_text().unwrap_or("").contains("ERROR"));
    }

    #[test]
    fn extract_text_string() {
        let val = serde_json::json!("hello");
        assert_eq!(extract_text_content(&val), "hello");
    }

    #[test]
    fn extract_text_array() {
        let val = serde_json::json!([{"text": "hello"}, {"text": "world"}]);
        assert_eq!(extract_text_content(&val), "hello\nworld");
    }

    #[test]
    fn extract_text_empty() {
        let val = serde_json::json!(null);
        assert_eq!(extract_text_content(&val), "");
    }
}
