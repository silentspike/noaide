use uuid::Uuid;

// === Session ===

#[derive(Debug, Clone)]
pub struct SessionComponent {
    pub id: Uuid,
    pub path: String,
    pub status: SessionStatus,
    pub model: Option<String>,
    pub started_at: i64,
    /// Epoch seconds of the last message in the JSONL (actual activity, not file mtime).
    pub last_activity_at: i64,
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
    /// Non-conversation JSONL entries: progress, summary, file-history-snapshot, etc.
    Meta,
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
    /// Hook/tool progress events
    Progress,
    /// Conversation summary (context compaction)
    Summary,
    /// File history snapshot
    FileSnapshot,
    /// Context compaction boundary marker (signals compaction just occurred)
    CompactBoundary,
}

// === Message Cache Meta ===

/// Tracks caching state for a session's JSONL file.
/// Used by the cache layer to know when to re-parse incrementally.
#[derive(Debug, Clone)]
pub struct CacheMetaComponent {
    pub session_id: Uuid,
    /// Byte offset up to which messages have been cached.
    pub file_offset: u64,
    /// Last known file size (for truncation detection).
    pub file_size: u64,
    /// Unix timestamp of last refresh.
    pub last_refreshed: i64,
    /// Number of cached messages for this session.
    pub message_count: usize,
    /// Whether the cache is warm (initial parse completed).
    pub is_warm: bool,
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

/// Marker: Claude is currently editing this file.
///
/// Used for Conflict Resolution (ADR-5, AC-14).
/// Spawned when eBPF detects a write from a Claude PID,
/// cleared after 2s idle timeout.
#[derive(Debug, Clone)]
pub struct ClaudeEditingComponent {
    pub file_path: String,
    pub session_id: Uuid,
    pub pid: u32,
    pub started_at: i64,
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
    /// JSON-serialized Vec<(String, String)> of request headers
    pub request_headers: Option<String>,
    /// JSON-serialized Vec<(String, String)> of response headers
    pub response_headers: Option<String>,
    pub request_size: Option<u64>,
    pub response_size: Option<u64>,
    /// Traffic category for CONNECT MITM requests (e.g. "telemetry", "auth").
    pub traffic_category: Option<String>,
}
