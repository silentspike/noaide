use serde::{Deserialize, Serialize};

// ============================================================
// Public API types — exactly as defined in Issue #9
// ============================================================

/// A parsed Claude Code JSONL message.
///
/// This is the public API type that flattens the nested JSONL structure
/// into a single struct. Internal raw types handle deserialization from
/// the actual JSONL format, then convert to this type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeMessage {
    pub uuid: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub role: Option<String>,
    pub content: MessageContent,
    pub timestamp: Option<String>,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<u64>,
    pub is_sidechain: Option<bool>,
    pub parent_uuid: Option<String>,
    pub agent_id: Option<String>,

    // Token tracking
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: serde_json::Value,
        is_error: Option<bool>,
    },
    #[serde(rename = "thinking")]
    Thinking { thinking: String },
    #[serde(rename = "image")]
    Image { source: ImageSource },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

// ============================================================
// Internal raw types — match the actual JSONL format
// Fields are used for serde deserialization completeness,
// not all are read after parsing.
// ============================================================

/// Common envelope fields present on most JSONL entries.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommonEnvelope {
    pub uuid: Option<String>,
    pub parent_uuid: Option<String>,
    pub session_id: Option<String>,
    pub is_sidechain: Option<bool>,
    pub timestamp: Option<String>,
    pub agent_id: Option<String>,
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub version: Option<String>,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub user_type: Option<String>,
    pub slug: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawUserEntry {
    #[serde(flatten)]
    pub envelope: CommonEnvelope,
    pub message: Option<RawUserMessage>,
    pub permission_mode: Option<String>,
    pub thinking_metadata: Option<serde_json::Value>,
    pub todos: Option<serde_json::Value>,
    pub tool_use_result: Option<serde_json::Value>,
    pub is_compact_summary: Option<bool>,
    pub is_meta: Option<bool>,
    pub is_visible_in_transcript_only: Option<bool>,
    pub source_tool_assistant_uuid: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RawUserMessage {
    pub role: Option<String>,
    pub content: MessageContent,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawAssistantEntry {
    #[serde(flatten)]
    pub envelope: CommonEnvelope,
    pub message: Option<RawAssistantMessage>,
    pub request_id: Option<String>,
    pub is_api_error_message: Option<bool>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RawAssistantMessage {
    pub model: Option<String>,
    pub id: Option<String>,
    pub role: Option<String>,
    pub content: Option<serde_json::Value>,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
    pub usage: Option<RawTokenUsage>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RawTokenUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawSystemEntry {
    #[serde(flatten)]
    pub envelope: CommonEnvelope,
    pub subtype: Option<String>,
    pub content: Option<serde_json::Value>,
    pub level: Option<String>,
    pub duration_ms: Option<u64>,
    pub hook_count: Option<u32>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawProgressEntry {
    #[serde(flatten)]
    pub envelope: CommonEnvelope,
    pub data: Option<serde_json::Value>,
    pub parent_tool_use_id: Option<String>,
    #[serde(alias = "toolUseID")]
    pub tool_use_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawSummaryEntry {
    pub summary: Option<String>,
    pub leaf_uuid: Option<String>,
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub uuid: Option<String>,
    pub timestamp: Option<String>,
    pub session_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawFileHistorySnapshot {
    pub message_id: Option<String>,
    pub snapshot: Option<serde_json::Value>,
    pub is_snapshot_update: Option<bool>,
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub uuid: Option<String>,
    pub timestamp: Option<String>,
}

// ============================================================
// Two-pass parsing: Value → type dispatch → typed struct → ClaudeMessage
// ============================================================

/// Parse a raw JSON value into a ClaudeMessage.
///
/// Uses a two-pass approach:
/// 1. Parse as `serde_json::Value` to extract the `type` field
/// 2. Dispatch to the appropriate typed struct
/// 3. Convert to the public `ClaudeMessage` type
pub fn parse_raw_to_message(value: serde_json::Value) -> Result<ClaudeMessage, serde_json::Error> {
    let entry_type = value
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    match entry_type.as_str() {
        "user" => {
            let raw: RawUserEntry = serde_json::from_value(value)?;
            Ok(user_to_message(raw))
        }
        "assistant" => {
            let raw: RawAssistantEntry = serde_json::from_value(value)?;
            Ok(assistant_to_message(raw))
        }
        "system" => {
            let raw: RawSystemEntry = serde_json::from_value(value)?;
            Ok(system_to_message(raw))
        }
        "progress" => {
            let raw: RawProgressEntry = serde_json::from_value(value)?;
            Ok(progress_to_message(raw))
        }
        "summary" => {
            let raw: RawSummaryEntry = serde_json::from_value(value)?;
            Ok(summary_to_message(raw))
        }
        "file-history-snapshot" => {
            let raw: RawFileHistorySnapshot = serde_json::from_value(value)?;
            Ok(file_snapshot_to_message(raw))
        }
        _ => {
            // Unknown type — create a minimal ClaudeMessage
            let uuid = value
                .get("uuid")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let timestamp = value
                .get("timestamp")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let is_sidechain = value.get("isSidechain").and_then(|v| v.as_bool());
            let parent_uuid = value
                .get("parentUuid")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let agent_id = value
                .get("agentId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            Ok(ClaudeMessage {
                uuid,
                message_type: entry_type,
                role: None,
                content: MessageContent::Text(String::new()),
                timestamp,
                model: None,
                stop_reason: None,
                cost_usd: None,
                duration_ms: None,
                is_sidechain,
                parent_uuid,
                agent_id,
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
                input_tokens: None,
                output_tokens: None,
            })
        }
    }
}

fn user_to_message(raw: RawUserEntry) -> ClaudeMessage {
    let (role, content) = match raw.message {
        Some(msg) => (msg.role, msg.content),
        None => (None, MessageContent::Text(String::new())),
    };

    ClaudeMessage {
        uuid: raw.envelope.uuid.unwrap_or_default(),
        message_type: "user".to_string(),
        role: role.or(Some("user".to_string())),
        content,
        timestamp: raw.envelope.timestamp,
        model: None,
        stop_reason: None,
        cost_usd: None,
        duration_ms: None,
        is_sidechain: raw.envelope.is_sidechain,
        parent_uuid: raw.envelope.parent_uuid,
        agent_id: raw.envelope.agent_id,
        cache_creation_input_tokens: None,
        cache_read_input_tokens: None,
        input_tokens: None,
        output_tokens: None,
    }
}

fn assistant_to_message(raw: RawAssistantEntry) -> ClaudeMessage {
    let (model, role, content, stop_reason, usage) = match raw.message {
        Some(msg) => {
            let content = match msg.content {
                Some(val) => {
                    // Try to parse as Vec<ContentBlock> first, fallback to text
                    if let Ok(blocks) = serde_json::from_value::<Vec<ContentBlock>>(val.clone()) {
                        MessageContent::Blocks(blocks)
                    } else if let Some(text) = val.as_str() {
                        MessageContent::Text(text.to_string())
                    } else {
                        MessageContent::Text(val.to_string())
                    }
                }
                None => MessageContent::Text(String::new()),
            };
            (msg.model, msg.role, content, msg.stop_reason, msg.usage)
        }
        None => (
            None,
            None,
            MessageContent::Text(String::new()),
            None,
            None,
        ),
    };

    let (input_tokens, output_tokens, cache_creation, cache_read) = match &usage {
        Some(u) => (
            u.input_tokens,
            u.output_tokens,
            u.cache_creation_input_tokens,
            u.cache_read_input_tokens,
        ),
        None => (None, None, None, None),
    };

    ClaudeMessage {
        uuid: raw.envelope.uuid.unwrap_or_default(),
        message_type: "assistant".to_string(),
        role: role.or(Some("assistant".to_string())),
        content,
        timestamp: raw.envelope.timestamp,
        model,
        stop_reason,
        cost_usd: None,
        duration_ms: None,
        is_sidechain: raw.envelope.is_sidechain,
        parent_uuid: raw.envelope.parent_uuid,
        agent_id: raw.envelope.agent_id,
        cache_creation_input_tokens: cache_creation,
        cache_read_input_tokens: cache_read,
        input_tokens,
        output_tokens,
    }
}

fn system_to_message(raw: RawSystemEntry) -> ClaudeMessage {
    let content_text = match raw.content {
        Some(val) => {
            if let Some(s) = val.as_str() {
                s.to_string()
            } else {
                val.to_string()
            }
        }
        None => String::new(),
    };

    let msg_type = match raw.subtype.as_deref() {
        Some("system-reminder") => "system-reminder",
        Some(other) => other,
        None => "system",
    };

    ClaudeMessage {
        uuid: raw.envelope.uuid.unwrap_or_default(),
        message_type: msg_type.to_string(),
        role: Some("system".to_string()),
        content: MessageContent::Text(content_text),
        timestamp: raw.envelope.timestamp,
        model: None,
        stop_reason: None,
        cost_usd: None,
        duration_ms: raw.duration_ms,
        is_sidechain: raw.envelope.is_sidechain,
        parent_uuid: raw.envelope.parent_uuid,
        agent_id: raw.envelope.agent_id,
        cache_creation_input_tokens: None,
        cache_read_input_tokens: None,
        input_tokens: None,
        output_tokens: None,
    }
}

fn progress_to_message(raw: RawProgressEntry) -> ClaudeMessage {
    let content_text = match raw.data {
        Some(val) => val.to_string(),
        None => String::new(),
    };

    ClaudeMessage {
        uuid: raw.envelope.uuid.unwrap_or_default(),
        message_type: "progress".to_string(),
        role: None,
        content: MessageContent::Text(content_text),
        timestamp: raw.envelope.timestamp,
        model: None,
        stop_reason: None,
        cost_usd: None,
        duration_ms: None,
        is_sidechain: raw.envelope.is_sidechain,
        parent_uuid: raw.envelope.parent_uuid,
        agent_id: raw.envelope.agent_id,
        cache_creation_input_tokens: None,
        cache_read_input_tokens: None,
        input_tokens: None,
        output_tokens: None,
    }
}

fn summary_to_message(raw: RawSummaryEntry) -> ClaudeMessage {
    ClaudeMessage {
        uuid: raw.uuid.unwrap_or_default(),
        message_type: "summary".to_string(),
        role: None,
        content: MessageContent::Text(raw.summary.unwrap_or_default()),
        timestamp: raw.timestamp,
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
    }
}

fn file_snapshot_to_message(raw: RawFileHistorySnapshot) -> ClaudeMessage {
    ClaudeMessage {
        uuid: raw.uuid.unwrap_or_default(),
        message_type: "file-history-snapshot".to_string(),
        role: None,
        content: MessageContent::Text(String::new()),
        timestamp: raw.timestamp,
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_user_message() {
        let json = r#"{
            "parentUuid": "abc-123",
            "isSidechain": false,
            "userType": "external",
            "cwd": "/work",
            "sessionId": "sess-1",
            "version": "2.1.49",
            "type": "user",
            "message": {"role": "user", "content": "hello world"},
            "uuid": "msg-1",
            "timestamp": "2026-02-21T10:00:00.000Z",
            "permissionMode": "default"
        }"#;

        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = parse_raw_to_message(value).unwrap();

        assert_eq!(msg.uuid, "msg-1");
        assert_eq!(msg.message_type, "user");
        assert_eq!(msg.role, Some("user".to_string()));
        assert!(matches!(msg.content, MessageContent::Text(ref s) if s == "hello world"));
        assert_eq!(msg.is_sidechain, Some(false));
        assert_eq!(msg.parent_uuid, Some("abc-123".to_string()));
    }

    #[test]
    fn parse_assistant_with_tool_use() {
        let json = r#"{
            "parentUuid": "msg-1",
            "isSidechain": false,
            "sessionId": "sess-1",
            "version": "2.1.49",
            "type": "assistant",
            "message": {
                "model": "claude-opus-4-6",
                "id": "msg_01abc",
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "Let me check."},
                    {"type": "tool_use", "id": "toolu_01", "name": "Bash", "input": {"command": "ls"}}
                ],
                "stop_reason": "tool_use",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_creation_input_tokens": 200,
                    "cache_read_input_tokens": 300
                }
            },
            "requestId": "req_01",
            "uuid": "msg-2",
            "timestamp": "2026-02-21T10:01:00.000Z"
        }"#;

        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = parse_raw_to_message(value).unwrap();

        assert_eq!(msg.message_type, "assistant");
        assert_eq!(msg.model, Some("claude-opus-4-6".to_string()));
        assert_eq!(msg.stop_reason, Some("tool_use".to_string()));
        assert_eq!(msg.input_tokens, Some(100));
        assert_eq!(msg.output_tokens, Some(50));
        assert_eq!(msg.cache_creation_input_tokens, Some(200));
        assert_eq!(msg.cache_read_input_tokens, Some(300));

        if let MessageContent::Blocks(blocks) = &msg.content {
            assert_eq!(blocks.len(), 2);
            assert!(matches!(&blocks[0], ContentBlock::Text { text } if text == "Let me check."));
            assert!(matches!(&blocks[1], ContentBlock::ToolUse { name, .. } if name == "Bash"));
        } else {
            panic!("expected Blocks content");
        }
    }

    #[test]
    fn parse_assistant_with_thinking() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "Let me reason about this..."},
                    {"type": "text", "text": "Here is my answer."}
                ],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 10, "output_tokens": 20}
            },
            "uuid": "msg-3",
            "timestamp": "2026-02-21T10:02:00.000Z"
        }"#;

        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = parse_raw_to_message(value).unwrap();

        if let MessageContent::Blocks(blocks) = &msg.content {
            assert_eq!(blocks.len(), 2);
            assert!(
                matches!(&blocks[0], ContentBlock::Thinking { thinking } if thinking.contains("reason"))
            );
        } else {
            panic!("expected Blocks content");
        }
    }

    #[test]
    fn parse_system_message() {
        let json = r#"{
            "type": "system",
            "subtype": "system-reminder",
            "uuid": "sys-1",
            "timestamp": "2026-02-21T10:03:00.000Z"
        }"#;

        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = parse_raw_to_message(value).unwrap();

        assert_eq!(msg.message_type, "system-reminder");
        assert_eq!(msg.role, Some("system".to_string()));
    }

    #[test]
    fn parse_progress_message() {
        let json = r#"{
            "type": "progress",
            "data": {"type": "hook_progress", "hookEvent": "SessionStart"},
            "uuid": "prog-1",
            "timestamp": "2026-02-21T10:04:00.000Z"
        }"#;

        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = parse_raw_to_message(value).unwrap();

        assert_eq!(msg.message_type, "progress");
    }

    #[test]
    fn parse_sidechain_subagent() {
        let json = r#"{
            "type": "user",
            "isSidechain": true,
            "agentId": "a08ef36",
            "sessionId": "sess-1",
            "message": {"role": "user", "content": "Warmup"},
            "uuid": "agent-msg-1",
            "timestamp": "2026-02-21T10:05:00.000Z"
        }"#;

        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = parse_raw_to_message(value).unwrap();

        assert_eq!(msg.is_sidechain, Some(true));
        assert_eq!(msg.agent_id, Some("a08ef36".to_string()));
    }

    #[test]
    fn parse_tool_result_content() {
        let json = r#"{
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "toolu_01abc",
                        "content": [{"type": "text", "text": "file contents here"}],
                        "is_error": false
                    }
                ]
            },
            "uuid": "tr-1",
            "timestamp": "2026-02-21T10:06:00.000Z"
        }"#;

        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = parse_raw_to_message(value).unwrap();

        if let MessageContent::Blocks(blocks) = &msg.content {
            assert_eq!(blocks.len(), 1);
            assert!(matches!(&blocks[0], ContentBlock::ToolResult { is_error, .. } if *is_error == Some(false)));
        } else {
            panic!("expected Blocks content");
        }
    }

    #[test]
    fn parse_unknown_type() {
        let json = r#"{
            "type": "future-type",
            "uuid": "future-1",
            "timestamp": "2026-02-21T10:07:00.000Z"
        }"#;

        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = parse_raw_to_message(value).unwrap();

        assert_eq!(msg.message_type, "future-type");
        assert_eq!(msg.uuid, "future-1");
    }

    #[test]
    fn parse_summary() {
        let json = r#"{
            "type": "summary",
            "summary": "Push Notification System Implementation Plan",
            "leafUuid": "leaf-1",
            "uuid": "sum-1"
        }"#;

        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = parse_raw_to_message(value).unwrap();

        assert_eq!(msg.message_type, "summary");
        assert!(matches!(msg.content, MessageContent::Text(ref s) if s.contains("Push Notification")));
    }
}
