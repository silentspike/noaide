pub mod managed;
pub mod observed;
pub mod types;

pub use managed::ManagedSession;
pub use observed::ObservedSession;
pub use types::{Session, SessionError, SessionEvent, SessionId, SessionMode, SessionState};

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use tracing::info;

/// Manages all active Claude Code sessions (managed + observed).
pub struct SessionManager {
    sessions: HashMap<SessionId, Arc<dyn Session>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Spawn a new managed Claude Code session via PTY.
    ///
    /// Returns the session ID on success.
    pub fn spawn_managed(
        &mut self,
        working_dir: &Path,
        anthropic_base_url: Option<&str>,
    ) -> Result<SessionId, SessionError> {
        let session = ManagedSession::spawn(working_dir, anthropic_base_url)?;
        let id = session.id().clone();
        self.sessions.insert(id.clone(), session);
        info!(session = %id, mode = "managed", "session registered");
        Ok(id)
    }

    /// Attach to an existing observed Claude Code session.
    ///
    /// Returns the session ID on success.
    pub async fn attach_observed(
        &mut self,
        jsonl_path: &Path,
        tmux_target: &str,
    ) -> Result<SessionId, SessionError> {
        let session = ObservedSession::attach(jsonl_path, tmux_target).await?;
        let id = session.id().clone();
        self.sessions.insert(id.clone(), session);
        info!(session = %id, mode = "observed", "session registered");
        Ok(id)
    }

    /// Get a session by ID.
    pub fn get(&self, id: &SessionId) -> Option<&dyn Session> {
        self.sessions.get(id).map(|s| s.as_ref())
    }

    /// List all sessions that are not closed.
    pub fn list_active(&self) -> Vec<&dyn Session> {
        self.sessions
            .values()
            .filter(|s| s.state() != SessionState::Closed)
            .map(|s| s.as_ref())
            .collect()
    }

    /// Remove a closed session from the manager.
    pub fn remove(&mut self, id: &SessionId) -> bool {
        self.sessions.remove(id).is_some()
    }

    /// Total number of tracked sessions (including closed).
    pub fn count(&self) -> usize {
        self.sessions.len()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_manager_new_empty() {
        let mgr = SessionManager::new();
        assert_eq!(mgr.count(), 0);
        assert!(mgr.list_active().is_empty());
    }

    #[test]
    fn session_manager_default() {
        let mgr = SessionManager::default();
        assert_eq!(mgr.count(), 0);
    }

    #[test]
    fn session_manager_get_nonexistent() {
        let mgr = SessionManager::new();
        let id = SessionId(uuid::Uuid::new_v4());
        assert!(mgr.get(&id).is_none());
    }

    #[test]
    fn session_manager_remove_nonexistent() {
        let mut mgr = SessionManager::new();
        let id = SessionId(uuid::Uuid::new_v4());
        assert!(!mgr.remove(&id));
    }

    #[test]
    fn spawn_managed_with_missing_claude() {
        // claude binary may not be installed — we still test that
        // the PTY system works (it will fail at spawn, not at PTY alloc)
        let mut mgr = SessionManager::new();
        let result = mgr.spawn_managed(Path::new("/tmp"), None);
        // May succeed or fail depending on whether `claude` is in PATH
        // Either way, no panic
        match result {
            Ok(id) => {
                assert_eq!(mgr.count(), 1);
                assert!(mgr.get(&id).is_some());
            }
            Err(_) => {
                assert_eq!(mgr.count(), 0);
            }
        }
    }
}
