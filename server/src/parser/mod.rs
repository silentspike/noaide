pub mod jsonl;
pub mod types;

pub use jsonl::{parse_file, parse_incremental, parse_line};
pub use types::{ClaudeMessage, ContentBlock, ImageSource, MessageContent};

use uuid::Uuid;

use crate::ecs::components::{MessageComponent, MessageRole, MessageType};

/// Convert a parsed ClaudeMessage into an ECS MessageComponent.
///
/// Returns `None` for message types that don't map to conversation
/// messages (e.g., `progress`, `file-history-snapshot`).
pub fn message_to_component(msg: &ClaudeMessage, session_id: Uuid) -> Option<MessageComponent> {
    let role = match msg.message_type.as_str() {
        "user" => MessageRole::User,
        "assistant" => MessageRole::Assistant,
        "system" | "system-reminder" => MessageRole::System,
        // progress, summary, file-history-snapshot etc. are not conversation messages
        _ => return None,
    };

    let (content_text, msg_type) = extract_content_and_type(&msg.content, &msg.message_type);

    // Preserve full ContentBlock structure as JSON for the API to return
    let content_blocks_json = match &msg.content {
        MessageContent::Blocks(blocks) => serde_json::to_string(blocks).ok(),
        MessageContent::Text(s) => {
            // Wrap plain text as a single text block for consistent API shape
            let blocks = vec![ContentBlock::Text { text: s.clone() }];
            serde_json::to_string(&blocks).ok()
        }
    };

    let msg_uuid = msg.uuid.parse::<Uuid>().unwrap_or_else(|_| Uuid::new_v4());

    let timestamp = msg
        .timestamp
        .as_deref()
        .and_then(parse_iso_timestamp)
        .unwrap_or(0);

    let tokens = msg.output_tokens.or(msg.input_tokens).map(|t| t as u32);

    Some(MessageComponent {
        id: msg_uuid,
        session_id,
        role,
        content: content_text,
        content_blocks_json,
        timestamp,
        tokens,
        hidden: false,
        message_type: msg_type,
        model: msg.model.clone(),
        stop_reason: msg.stop_reason.clone(),
        input_tokens: msg.input_tokens.map(|t| t as u32),
        output_tokens: msg.output_tokens.map(|t| t as u32),
        cache_creation_input_tokens: msg.cache_creation_input_tokens.map(|t| t as u32),
        cache_read_input_tokens: msg.cache_read_input_tokens.map(|t| t as u32),
    })
}

/// Extract text content and determine message type from MessageContent.
fn extract_content_and_type(content: &MessageContent, msg_type: &str) -> (String, MessageType) {
    match content {
        MessageContent::Text(s) => {
            let ecs_type = if msg_type == "system-reminder" {
                MessageType::SystemReminder
            } else {
                MessageType::Text
            };
            (s.clone(), ecs_type)
        }
        MessageContent::Blocks(blocks) => {
            let mut text_parts = Vec::new();
            let mut dominant_type = MessageType::Text;

            for block in blocks {
                match block {
                    ContentBlock::Text { text } => {
                        text_parts.push(text.clone());
                    }
                    ContentBlock::ToolUse { name, input, .. } => {
                        text_parts.push(format!("[tool_use: {name}]"));
                        let _ = input; // stored in raw content, not text summary
                        dominant_type = MessageType::ToolUse;
                    }
                    ContentBlock::ToolResult {
                        content, is_error, ..
                    } => {
                        let error_marker = if *is_error == Some(true) {
                            " (error)"
                        } else {
                            ""
                        };
                        if let Some(s) = content.as_str() {
                            text_parts.push(format!("[tool_result{error_marker}: {s}]"));
                        } else {
                            text_parts.push(format!("[tool_result{error_marker}]"));
                        }
                        dominant_type = MessageType::ToolResult;
                    }
                    ContentBlock::Thinking { thinking } => {
                        text_parts.push(thinking.clone());
                        dominant_type = MessageType::Thinking;
                    }
                    ContentBlock::Image { .. } => {
                        text_parts.push("[image]".to_string());
                    }
                }
            }

            (text_parts.join("\n"), dominant_type)
        }
    }
}

/// Parse an ISO-8601 timestamp string to Unix timestamp (seconds).
///
/// Handles the format `2026-02-21T10:00:00.000Z`.
fn parse_iso_timestamp(ts: &str) -> Option<i64> {
    // Minimal parser for ISO-8601 format: YYYY-MM-DDTHH:MM:SS[.sss]Z
    let ts = ts.trim_end_matches('Z');
    let (date_part, time_part) = ts.split_once('T')?;

    let mut date_parts = date_part.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;

    let time_no_frac = time_part.split('.').next()?;
    let mut time_parts = time_no_frac.split(':');
    let hour: i64 = time_parts.next()?.parse().ok()?;
    let minute: i64 = time_parts.next()?.parse().ok()?;
    let second: i64 = time_parts.next()?.parse().ok()?;

    // Simplified days-since-epoch calculation (good enough for 2000-2100)
    let mut days = 0i64;
    for y in 1970..year {
        days += if is_leap_year(y) { 366 } else { 365 };
    }
    let month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for m in 1..month {
        days += month_days[(m - 1) as usize];
        if m == 2 && is_leap_year(year) {
            days += 1;
        }
    }
    days += day - 1;

    Some(days * 86400 + hour * 3600 + minute * 60 + second)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_parsing() {
        let ts = parse_iso_timestamp("2026-02-21T10:30:00.000Z").unwrap();
        // 2026-02-21 10:30:00 UTC
        assert!(ts > 1_700_000_000); // after 2023
        assert!(ts < 2_000_000_000); // before 2033
    }

    #[test]
    fn timestamp_without_millis() {
        let ts = parse_iso_timestamp("2026-02-21T10:30:00Z").unwrap();
        assert!(ts > 1_700_000_000);
    }

    #[test]
    fn message_to_component_user() {
        let msg = ClaudeMessage {
            uuid: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            message_type: "user".to_string(),
            role: Some("user".to_string()),
            content: MessageContent::Text("hello".to_string()),
            timestamp: Some("2026-02-21T10:00:00Z".to_string()),
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
            is_sidechain: None,
            parent_uuid: None,
            agent_id: None,
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            input_tokens: None,
            output_tokens: None,
        };

        let session_id = Uuid::new_v4();
        let component = message_to_component(&msg, session_id).unwrap();

        assert_eq!(component.role, MessageRole::User);
        assert_eq!(component.content, "hello");
        assert_eq!(component.message_type, MessageType::Text);
        assert_eq!(component.session_id, session_id);
    }

    #[test]
    fn message_to_component_assistant_with_tools() {
        let msg = ClaudeMessage {
            uuid: "550e8400-e29b-41d4-a716-446655440001".to_string(),
            message_type: "assistant".to_string(),
            role: Some("assistant".to_string()),
            content: MessageContent::Blocks(vec![
                ContentBlock::Text {
                    text: "Let me check.".to_string(),
                },
                ContentBlock::ToolUse {
                    id: "toolu_1".to_string(),
                    name: "Bash".to_string(),
                    input: serde_json::json!({"command": "ls"}),
                },
            ]),
            timestamp: Some("2026-02-21T10:01:00Z".to_string()),
            model: Some("claude-opus-4-6".to_string()),
            stop_reason: Some("tool_use".to_string()),
            cost_usd: None,
            duration_ms: None,
            is_sidechain: None,
            parent_uuid: None,
            agent_id: None,
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            input_tokens: None,
            output_tokens: Some(50),
        };

        let component = message_to_component(&msg, Uuid::new_v4()).unwrap();

        assert_eq!(component.role, MessageRole::Assistant);
        assert_eq!(component.message_type, MessageType::ToolUse);
        assert!(component.content.contains("Let me check."));
        assert!(component.content.contains("[tool_use: Bash]"));
        assert_eq!(component.tokens, Some(50));
    }

    #[test]
    fn message_to_component_skips_progress() {
        let msg = ClaudeMessage {
            uuid: "test".to_string(),
            message_type: "progress".to_string(),
            role: None,
            content: MessageContent::Text(String::new()),
            timestamp: None,
            model: None,
            stop_reason: None,
            cost_usd: None,
            duration_ms: None,
            is_sidechain: None,
            parent_uuid: None,
            agent_id: None,
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
            input_tokens: None,
            output_tokens: None,
        };

        assert!(message_to_component(&msg, Uuid::new_v4()).is_none());
    }
}
