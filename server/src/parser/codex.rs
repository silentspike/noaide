//! Codex CLI JSONL parser.
//!
//! Codex stores sessions as JSONL files at:
//! `~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{uuid}.jsonl`
//!
//! Each line has: `{ "timestamp": "ISO", "type": "...", "payload": {...} }`
//!
//! Types: session_meta, event_msg, response_item, turn_context
//! event_msg subtypes: user_message, agent_message, agent_reasoning,
//!                     token_count, turn_aborted, context_compacted

use std::path::Path;

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing::warn;
use uuid::Uuid;

use super::types::{ClaudeMessage, ContentBlock, MessageContent};

/// Raw Codex JSONL line structure.
#[derive(Deserialize)]
struct CodexLine {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    line_type: String,
    payload: serde_json::Value,
}

/// Parse a Codex JSONL file into ClaudeMessage format.
pub async fn parse_codex_file(path: &Path) -> anyhow::Result<Vec<ClaudeMessage>> {
    let file = tokio::fs::File::open(path).await?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut messages = Vec::new();
    let mut line_num = 0u64;
    let mut current_model: Option<String> = None;

    while let Some(line) = lines.next_line().await? {
        line_num += 1;
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let entry: CodexLine = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(e) => {
                if line_num <= 3 {
                    warn!(line = line_num, error = %e, "codex: malformed line");
                }
                continue;
            }
        };

        match entry.line_type.as_str() {
            "session_meta" => {
                messages.push(codex_session_meta(&entry));
            }
            "event_msg" => {
                if let Some(msg) = codex_event_msg(&entry, &current_model) {
                    messages.push(msg);
                }
            }
            "response_item" => {
                if let Some(msg) = codex_response_item(&entry, &current_model) {
                    messages.push(msg);
                }
            }
            "turn_context" => {
                // Extract model info
                if let Some(model) = entry.payload.get("model").and_then(|v| v.as_str()) {
                    current_model = Some(model.to_string());
                }
                messages.push(codex_turn_context(&entry));
            }
            other => {
                // Unknown type — preserve as meta
                messages.push(ClaudeMessage {
                    uuid: Uuid::new_v4().to_string(),
                    message_type: other.to_string(),
                    role: None,
                    content: MessageContent::Text(
                        serde_json::to_string(&entry.payload).unwrap_or_default(),
                    ),
                    timestamp: entry.timestamp,
                    model: current_model.clone(),
                    ..Default::default()
                });
            }
        }
    }

    Ok(messages)
}

/// Convert session_meta to a meta message.
fn codex_session_meta(entry: &CodexLine) -> ClaudeMessage {
    let id = entry
        .payload
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let cli_version = entry
        .payload
        .get("cli_version")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let cwd = entry
        .payload
        .get("cwd")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    ClaudeMessage {
        uuid: if id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            id
        },
        message_type: "progress".to_string(),
        role: None,
        content: MessageContent::Text(format!(
            "{{\"type\":\"session_meta\",\"cli\":\"codex\",\"version\":\"{cli_version}\",\"cwd\":\"{cwd}\"}}"
        )),
        timestamp: entry.timestamp.clone(),
        ..Default::default()
    }
}

/// Convert event_msg to the appropriate message type.
fn codex_event_msg(entry: &CodexLine, model: &Option<String>) -> Option<ClaudeMessage> {
    let subtype = entry
        .payload
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    match subtype {
        "user_message" => {
            let text = entry
                .payload
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            Some(ClaudeMessage {
                uuid: Uuid::new_v4().to_string(),
                message_type: "user".to_string(),
                role: Some("user".to_string()),
                content: MessageContent::Blocks(vec![ContentBlock::Text { text }]),
                timestamp: entry.timestamp.clone(),
                model: model.clone(),
                ..Default::default()
            })
        }
        "agent_message" => {
            let text = entry
                .payload
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            Some(ClaudeMessage {
                uuid: Uuid::new_v4().to_string(),
                message_type: "assistant".to_string(),
                role: Some("assistant".to_string()),
                content: MessageContent::Blocks(vec![ContentBlock::Text { text }]),
                timestamp: entry.timestamp.clone(),
                model: model.clone(),
                ..Default::default()
            })
        }
        "agent_reasoning" => {
            let text = entry
                .payload
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            Some(ClaudeMessage {
                uuid: Uuid::new_v4().to_string(),
                message_type: "assistant".to_string(),
                role: Some("assistant".to_string()),
                content: MessageContent::Blocks(vec![ContentBlock::Thinking { thinking: text }]),
                timestamp: entry.timestamp.clone(),
                model: model.clone(),
                ..Default::default()
            })
        }
        "token_count" | "turn_aborted" | "context_compacted" => {
            // Meta events
            Some(ClaudeMessage {
                uuid: Uuid::new_v4().to_string(),
                message_type: "progress".to_string(),
                role: None,
                content: MessageContent::Text(
                    serde_json::to_string(&entry.payload).unwrap_or_default(),
                ),
                timestamp: entry.timestamp.clone(),
                model: model.clone(),
                ..Default::default()
            })
        }
        _ => {
            // Unknown event_msg subtype — preserve as meta
            Some(ClaudeMessage {
                uuid: Uuid::new_v4().to_string(),
                message_type: "progress".to_string(),
                role: None,
                content: MessageContent::Text(
                    serde_json::to_string(&entry.payload).unwrap_or_default(),
                ),
                timestamp: entry.timestamp.clone(),
                model: model.clone(),
                ..Default::default()
            })
        }
    }
}

/// Convert response_item to a message.
fn codex_response_item(entry: &CodexLine, model: &Option<String>) -> Option<ClaudeMessage> {
    let role = entry
        .payload
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("assistant");

    let content_arr = entry.payload.get("content")?.as_array()?;
    let mut blocks = Vec::new();

    for item in content_arr {
        let ct = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match ct {
            "input_text" | "output_text" => {
                let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
                if !text.is_empty() {
                    blocks.push(ContentBlock::Text {
                        text: text.to_string(),
                    });
                }
            }
            "input_image" => {
                blocks.push(ContentBlock::Text {
                    text: "[image]".to_string(),
                });
            }
            _ => {
                // Unknown content type — preserve as text
                let json = serde_json::to_string(item).unwrap_or_default();
                if !json.is_empty() {
                    blocks.push(ContentBlock::Text { text: json });
                }
            }
        }
    }

    if blocks.is_empty() {
        return None;
    }

    let (msg_type, msg_role) = match role {
        "user" => ("user", Some("user".to_string())),
        "assistant" => ("assistant", Some("assistant".to_string())),
        _ => ("assistant", Some("assistant".to_string())),
    };

    Some(ClaudeMessage {
        uuid: Uuid::new_v4().to_string(),
        message_type: msg_type.to_string(),
        role: msg_role,
        content: MessageContent::Blocks(blocks),
        timestamp: entry.timestamp.clone(),
        model: model.clone(),
        ..Default::default()
    })
}

/// Convert turn_context to a meta message.
fn codex_turn_context(entry: &CodexLine) -> ClaudeMessage {
    let model = entry
        .payload
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    ClaudeMessage {
        uuid: Uuid::new_v4().to_string(),
        message_type: "progress".to_string(),
        role: None,
        content: MessageContent::Text(format!(
            "{{\"type\":\"turn_context\",\"model\":\"{model}\"}}"
        )),
        timestamp: entry.timestamp.clone(),
        model: Some(model.to_string()),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_codex_user_message() {
        let line = r#"{"timestamp":"2025-10-26T11:54:30Z","type":"event_msg","payload":{"type":"user_message","message":"hello world","images":[]}}"#;
        let entry: CodexLine = serde_json::from_str(line).unwrap();
        let msg = codex_event_msg(&entry, &None).unwrap();
        assert_eq!(msg.message_type, "user");
        assert!(matches!(msg.content, MessageContent::Blocks(ref b) if !b.is_empty()));
    }

    #[test]
    fn parse_codex_agent_reasoning() {
        let line = r#"{"timestamp":"2025-10-26T11:55:00Z","type":"event_msg","payload":{"type":"agent_reasoning","text":"Let me think about this..."}}"#;
        let entry: CodexLine = serde_json::from_str(line).unwrap();
        let msg = codex_event_msg(&entry, &Some("gpt-5.2-codex".to_string())).unwrap();
        assert_eq!(msg.message_type, "assistant");
        assert!(matches!(
            &msg.content,
            MessageContent::Blocks(b) if matches!(&b[0], ContentBlock::Thinking { thinking } if thinking.contains("think"))
        ));
    }

    #[test]
    fn parse_codex_response_item() {
        let line = r#"{"timestamp":"2025-10-26T11:55:00Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello!"}]}}"#;
        let entry: CodexLine = serde_json::from_str(line).unwrap();
        let msg = codex_response_item(&entry, &None).unwrap();
        assert_eq!(msg.message_type, "assistant");
    }

    #[test]
    fn parse_codex_turn_context_extracts_model() {
        let line = r#"{"timestamp":"2025-10-26T11:55:00Z","type":"turn_context","payload":{"model":"gpt-5.2-codex","cwd":"/home/jan"}}"#;
        let entry: CodexLine = serde_json::from_str(line).unwrap();
        let msg = codex_turn_context(&entry);
        assert_eq!(msg.model, Some("gpt-5.2-codex".to_string()));
    }
}
