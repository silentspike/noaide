use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher};
use tokio::sync::{RwLock, broadcast};

use super::events::{FileEvent, FileEventKind};
use super::{Watcher, WatcherError};

/// Inotify-based file watcher using the `notify` crate.
///
/// This is the fallback watcher when eBPF is unavailable.
/// It does NOT provide PID attribution (`pid` is always `None`).
pub struct InotifyWatcher {
    tx: broadcast::Sender<FileEvent>,
    watcher: Arc<RwLock<RecommendedWatcher>>,
    watched_paths: Arc<RwLock<HashSet<PathBuf>>>,
}

impl InotifyWatcher {
    pub fn new(capacity: usize) -> Result<Self, WatcherError> {
        let (tx, _) = broadcast::channel(capacity);
        let tx_clone = tx.clone();

        let watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| match result {
                Ok(event) => {
                    if let Some(file_event) = map_notify_event(event) {
                        // Ignore send errors (no active receivers is OK)
                        let _ = tx_clone.send(file_event);
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "inotify event error");
                }
            },
            Config::default(),
        )?;

        Ok(Self {
            tx,
            watcher: Arc::new(RwLock::new(watcher)),
            watched_paths: Arc::new(RwLock::new(HashSet::new())),
        })
    }
}

#[async_trait::async_trait]
impl Watcher for InotifyWatcher {
    async fn watch(&self, path: &Path) -> anyhow::Result<()> {
        let canonical = path.canonicalize()?;
        let mut w = self.watcher.write().await;
        w.watch(&canonical, RecursiveMode::Recursive)?;
        self.watched_paths.write().await.insert(canonical.clone());
        tracing::debug!(path = %canonical.display(), "inotify watching");
        Ok(())
    }

    async fn unwatch(&self, path: &Path) -> anyhow::Result<()> {
        let canonical = path.canonicalize()?;
        let mut w = self.watcher.write().await;
        w.unwatch(&canonical)?;
        self.watched_paths.write().await.remove(&canonical);
        tracing::debug!(path = %canonical.display(), "inotify unwatched");
        Ok(())
    }

    fn events(&self) -> broadcast::Receiver<FileEvent> {
        self.tx.subscribe()
    }

    fn backend_name(&self) -> &'static str {
        "inotify"
    }
}

fn map_notify_event(event: Event) -> Option<FileEvent> {
    let kind = match event.kind {
        notify::EventKind::Create(_) => FileEventKind::Created,
        notify::EventKind::Modify(notify::event::ModifyKind::Data(_)) => FileEventKind::Modified,
        // Also treat metadata modifications as modifications
        notify::EventKind::Modify(notify::event::ModifyKind::Name(
            notify::event::RenameMode::To,
        )) => FileEventKind::Created,
        notify::EventKind::Remove(_) => FileEventKind::Deleted,
        _ => return None,
    };

    let path = event.paths.into_iter().next()?;

    Some(FileEvent {
        path,
        kind,
        pid: None,
        timestamp: Instant::now(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn detect_file_create() {
        let dir = TempDir::new().unwrap();
        let watcher = InotifyWatcher::new(1024).unwrap();
        let mut rx = watcher.events();
        watcher.watch(dir.path()).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        fs::write(dir.path().join("test.txt"), "hello").unwrap();

        let event = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .unwrap()
            .unwrap();

        assert!(event.path.ends_with("test.txt"));
        // inotify may report Create or Modify depending on timing
        assert!(
            event.kind == FileEventKind::Created || event.kind == FileEventKind::Modified,
            "expected Create or Modify, got {:?}",
            event.kind
        );
        assert_eq!(event.pid, None);
    }

    #[tokio::test]
    async fn detect_file_modify() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("existing.txt");
        fs::write(&path, "initial").unwrap();

        let watcher = InotifyWatcher::new(1024).unwrap();
        let mut rx = watcher.events();
        watcher.watch(dir.path()).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        fs::write(&path, "modified").unwrap();

        let event = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .unwrap()
            .unwrap();

        assert!(event.path.ends_with("existing.txt"));
        assert_eq!(event.kind, FileEventKind::Modified);
    }

    #[tokio::test]
    async fn detect_file_delete() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("to_delete.txt");
        fs::write(&path, "delete me").unwrap();

        let watcher = InotifyWatcher::new(1024).unwrap();
        let mut rx = watcher.events();
        watcher.watch(dir.path()).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        fs::remove_file(&path).unwrap();

        let event = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .unwrap()
            .unwrap();

        assert!(event.path.ends_with("to_delete.txt"));
        assert_eq!(event.kind, FileEventKind::Deleted);
    }

    #[tokio::test]
    async fn unwatch_stops_events() {
        let dir = TempDir::new().unwrap();
        let watcher = InotifyWatcher::new(1024).unwrap();
        let mut rx = watcher.events();

        watcher.watch(dir.path()).await.unwrap();
        watcher.unwatch(dir.path()).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        fs::write(dir.path().join("ignored.txt"), "should not fire").unwrap();

        let result = tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await;
        assert!(result.is_err(), "should not receive events after unwatch");
    }

    #[tokio::test]
    async fn no_panic_on_missing_dir() {
        let watcher = InotifyWatcher::new(1024).unwrap();
        let result = watcher.watch(Path::new("/nonexistent/path")).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn multiple_events_received() {
        let dir = TempDir::new().unwrap();
        let watcher = InotifyWatcher::new(1024).unwrap();
        let mut rx = watcher.events();
        watcher.watch(dir.path()).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        for i in 0..10 {
            fs::write(dir.path().join(format!("file_{i}.txt")), "data").unwrap();
        }

        let mut count = 0;
        let deadline = Instant::now() + std::time::Duration::from_secs(3);
        while count < 10 && Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await {
                Ok(Ok(_)) => count += 1,
                _ => break,
            }
        }
        assert!(count >= 5, "expected at least 5 events, got {count}");
    }
}
