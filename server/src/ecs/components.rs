use uuid::Uuid;

// === Session ===

#[derive(Debug, Clone)]
pub struct SessionComponent {
    pub id: Uuid,
    pub path: String,
    pub status: SessionStatus,
    pub model: Option<String>,
    pub started_at: i64,
    pub cost: Option<f64>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SessionStatus {
    #[default]
    Active,
    Idle,
    Archived,
    Error,
}

// === Message ===

#[derive(Debug, Clone)]
pub struct MessageComponent {
    pub id: Uuid,
    pub session_id: Uuid,
    pub role: MessageRole,
    pub content: String,
    /// Serialized JSON of the original ContentBlock[] from JSONL.
    /// Preserves full structure (tool inputs, tool_use_ids, is_error, etc.)
    /// that gets lost in the flattened `content` string.
    pub content_blocks_json: Option<String>,
    pub timestamp: i64,
    pub tokens: Option<u32>,
    pub hidden: bool,
    pub message_type: MessageType,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub cache_creation_input_tokens: Option<u32>,
    pub cache_read_input_tokens: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MessageRole {
    #[default]
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MessageType {
    #[default]
    Text,
    ToolUse,
    ToolResult,
    Thinking,
    SystemReminder,
    Error,
}

// === File ===

#[derive(Debug, Clone)]
pub struct FileComponent {
    pub id: Uuid,
    pub session_id: Uuid,
    pub path: String,
    pub modified: i64,
    pub size: u64,
}

// === Task ===

#[derive(Debug, Clone)]
pub struct TaskComponent {
    pub id: Uuid,
    pub session_id: Uuid,
    pub subject: String,
    pub status: String,
    pub owner: Option<String>,
}

// === Agent ===

#[derive(Debug, Clone)]
pub struct AgentComponent {
    pub id: Uuid,
    pub session_id: Uuid,
    pub name: String,
    pub agent_type: String,
    pub parent_id: Option<Uuid>,
}

// === API Request ===

#[derive(Debug, Clone)]
pub struct ApiRequestComponent {
    pub id: Uuid,
    pub session_id: Uuid,
    pub method: String,
    pub url: String,
    pub request_body: Option<String>,
    pub response_body: Option<String>,
    pub status_code: Option<u16>,
    pub latency_ms: Option<u32>,
    pub timestamp: i64,
}
