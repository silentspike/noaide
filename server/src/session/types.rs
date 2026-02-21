use tokio::sync::broadcast;
use uuid::Uuid;

/// How a session is controlled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionMode {
    /// IDE spawned the `claude` process via PTY — full stdin/stdout control.
    Managed,
    /// External session in a terminal/tmux — JSONL watch + `tmux send-keys`.
    Observed,
}

/// Newtype wrapper around a UUID identifying a session.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessionId(pub Uuid);

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Events emitted by a session.
#[derive(Debug, Clone)]
pub enum SessionEvent {
    /// Raw stdout data from the session.
    Output(String),
    /// Session state changed.
    StateChange(SessionState),
    /// An error occurred in the session.
    Error(String),
    /// Session has been closed.
    Closed,
}

/// Lifecycle state of a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    /// Session is starting up.
    Starting,
    /// Session is actively producing output.
    Active,
    /// No output for >2 seconds.
    Idle,
    /// Session encountered an error.
    Error,
    /// Session has been closed.
    Closed,
}

/// Errors specific to session management.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("PTY spawn failed: {0}")]
    PtySpawn(String),
    #[error("PTY I/O error: {0}")]
    PtyIo(#[from] std::io::Error),
    #[error("tmux command failed: {0}")]
    TmuxCommand(String),
    #[error("session not found: {0}")]
    NotFound(SessionId),
    #[error("session already closed: {0}")]
    AlreadyClosed(SessionId),
    #[error("JSONL path does not exist: {0}")]
    JsonlNotFound(String),
    #[error("tmux session not active: {0}")]
    TmuxNotActive(String),
}

/// Broadcast channel capacity for session events.
pub const SESSION_EVENT_CAPACITY: usize = 256;

/// Trait for a controllable Claude Code session.
///
/// Two implementations exist:
/// - `ManagedSession`: IDE-spawned process via PTY
/// - `ObservedSession`: Existing terminal session via JSONL + tmux
#[async_trait::async_trait]
pub trait Session: Send + Sync {
    /// Unique session identifier.
    fn id(&self) -> &SessionId;

    /// How this session is controlled.
    fn mode(&self) -> SessionMode;

    /// Current lifecycle state.
    fn state(&self) -> SessionState;

    /// Send text input to the session.
    ///
    /// - Managed: writes to PTY stdin
    /// - Observed: executes `tmux send-keys`
    async fn send_input(&self, text: &str) -> anyhow::Result<()>;

    /// Get a receiver for session events (output, state changes).
    ///
    /// Each call returns a new receiver; events are broadcast to all.
    fn events(&self) -> broadcast::Receiver<SessionEvent>;

    /// Gracefully close the session.
    async fn close(&self) -> anyhow::Result<()>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_id_display() {
        let id = SessionId(Uuid::nil());
        assert_eq!(id.to_string(), "00000000-0000-0000-0000-000000000000");
    }

    #[test]
    fn session_id_equality() {
        let uuid = Uuid::new_v4();
        let a = SessionId(uuid);
        let b = SessionId(uuid);
        assert_eq!(a, b);
    }

    #[test]
    fn session_state_copy() {
        let state = SessionState::Active;
        let copy = state;
        assert_eq!(state, copy);
    }

    #[test]
    fn session_mode_variants() {
        assert_ne!(SessionMode::Managed, SessionMode::Observed);
    }

    #[test]
    fn session_error_display() {
        let err = SessionError::TmuxCommand("not found".into());
        assert!(err.to_string().contains("tmux command failed"));
    }
}
