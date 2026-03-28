pub mod listing;
pub mod serve;

pub use listing::{FileEntry, list_directory, validate_path_within_root};
pub use serve::{FileContent, read_file_content, write_file_content};

use serde::{Deserialize, Serialize};

/// Errors that can occur when listing or serving files.
#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("path traversal detected")]
    PathTraversal,
    #[error("project directory not found")]
    ProjectNotFound,
    #[error("file too large: {size} bytes (max {max})")]
    FileTooLarge { size: u64, max: u64 },
    #[error("binary file")]
    BinaryFile,
}

/// Payload for FILE_CHANGES bus events.
///
/// Serialized with MessagePack (rmp_serde) on the Hot Path,
/// NOT JSON. Delivered via WebTransport to all connected clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangePayload {
    /// Path relative to project root.
    pub path: String,
    /// Event kind: "created", "modified", or "deleted".
    pub kind: String,
    /// PID of the process that triggered the change (eBPF only, None for inotify).
    pub pid: Option<u32>,
    /// Session UUID that owns this project directory.
    pub session_id: String,
    /// Absolute path of the project root this event belongs to.
    /// Used by the frontend to filter events: only apply events whose
    /// project_root matches the active session's project directory.
    pub project_root: String,
    /// Wall clock timestamp in milliseconds.
    pub timestamp: i64,
    /// For files <100KB that a client has open: new content pushed directly
    /// in the event payload (saves HTTP round-trip via WebTransport).
    pub content: Option<String>,
    /// File size in bytes (None for deleted files).
    pub size: Option<u64>,
}
