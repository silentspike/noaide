pub mod ebpf;
pub mod events;
pub mod fallback;

pub use events::{FileEvent, FileEventKind};

use std::path::Path;
use tokio::sync::broadcast;

/// Broadcast channel capacity for file events.
/// At 1000 events/sec target, 1024 gives ~1s buffer.
const EVENT_CHANNEL_CAPACITY: usize = 1024;

/// Trait for file system watchers.
///
/// Two backends exist:
/// - `EbpfWatcher`: eBPF tracepoints with PID attribution (requires CAP_BPF)
/// - `InotifyWatcher`: Cross-platform fallback via `notify` crate (no PID)
#[async_trait::async_trait]
pub trait Watcher: Send + Sync {
    /// Start watching a directory recursively.
    async fn watch(&self, path: &Path) -> anyhow::Result<()>;

    /// Stop watching a directory.
    async fn unwatch(&self, path: &Path) -> anyhow::Result<()>;

    /// Get a receiver for file events.
    /// Each call returns a new receiver; events are broadcast to all.
    fn events(&self) -> broadcast::Receiver<FileEvent>;

    /// Returns the backend name for logging/diagnostics.
    fn backend_name(&self) -> &'static str;
}

/// Errors specific to the watcher module.
#[derive(Debug, thiserror::Error)]
pub enum WatcherError {
    #[error("eBPF load failed: {0}")]
    EbpfLoad(aya::EbpfError),
    #[error("eBPF program not found: {0}")]
    EbpfProgram(String),
    #[error("eBPF attach failed: {0}")]
    EbpfAttach(String),
    #[error("inotify watcher failed: {0}")]
    Notify(#[from] notify::Error),
}

/// Creates the appropriate watcher based on capabilities.
///
/// If `enable_ebpf` is true, tries eBPF first, falls back to inotify on error.
/// If false, uses inotify directly.
pub fn create_watcher(enable_ebpf: bool) -> anyhow::Result<Box<dyn Watcher>> {
    if enable_ebpf {
        match ebpf::EbpfWatcher::new(EVENT_CHANNEL_CAPACITY) {
            Ok(w) => {
                tracing::info!(
                    backend = "ebpf",
                    "file watcher initialized with PID attribution"
                );
                return Ok(Box::new(w));
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "eBPF unavailable, falling back to inotify (no PID attribution)"
                );
            }
        }
    } else {
        tracing::info!("eBPF disabled via ENABLE_EBPF=false, using inotify");
    }

    let w = fallback::InotifyWatcher::new(EVENT_CHANNEL_CAPACITY)?;
    tracing::info!(
        backend = "inotify",
        "file watcher initialized (no PID attribution)"
    );
    Ok(Box::new(w))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_watcher_inotify_fallback() {
        let watcher = create_watcher(false).unwrap();
        assert_eq!(watcher.backend_name(), "inotify");
    }

    #[test]
    fn create_watcher_ebpf_fallback_on_no_capabilities() {
        // In CI / unprivileged environment, eBPF load fails
        // and factory automatically falls back to inotify
        let watcher = create_watcher(true).unwrap();
        // Backend is either ebpf (if privileged) or inotify (fallback)
        assert!(!watcher.backend_name().is_empty());
    }
}
