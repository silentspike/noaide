use std::path::PathBuf;
use std::time::Instant;

/// The kind of file system event detected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileEventKind {
    Created,
    Modified,
    Deleted,
}

/// A file system event with optional PID attribution.
///
/// When using the eBPF backend, `pid` contains the PID of the process
/// that triggered the event. With the inotify fallback, `pid` is `None`.
#[derive(Debug, Clone)]
pub struct FileEvent {
    pub path: PathBuf,
    pub kind: FileEventKind,
    /// `Some(pid)` when eBPF is active, `None` for inotify fallback.
    pub pid: Option<u32>,
    pub timestamp: Instant,
}
