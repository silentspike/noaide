use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};

use tokio::sync::broadcast;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::parser;

use super::types::{
    SESSION_EVENT_CAPACITY, Session, SessionError, SessionEvent, SessionId, SessionMode,
    SessionState,
};

/// State encoding (same as managed.rs).
const STATE_STARTING: u8 = 0;
const STATE_ACTIVE: u8 = 1;
const STATE_IDLE: u8 = 2;
const STATE_ERROR: u8 = 3;
const STATE_CLOSED: u8 = 4;

fn state_from_u8(v: u8) -> SessionState {
    match v {
        STATE_STARTING => SessionState::Starting,
        STATE_ACTIVE => SessionState::Active,
        STATE_IDLE => SessionState::Idle,
        STATE_ERROR => SessionState::Error,
        STATE_CLOSED => SessionState::Closed,
        _ => SessionState::Error,
    }
}

/// An observed session: existing Claude Code process in a terminal/tmux.
///
/// Output is read by tailing the JSONL file.
/// Input is sent via `tmux send-keys -t <session> <text> Enter`.
#[allow(dead_code)] // jsonl_path stored for diagnostics/future use
pub struct ObservedSession {
    id: SessionId,
    state: AtomicU8,
    jsonl_path: PathBuf,
    tmux_target: String,
    event_tx: broadcast::Sender<SessionEvent>,
    /// Signal to stop the tailing task.
    shutdown: tokio::sync::watch::Sender<bool>,
}

impl ObservedSession {
    /// Attach to an existing Claude Code session.
    ///
    /// - `jsonl_path`: path to the session's JSONL file
    /// - `tmux_target`: tmux session/pane target (e.g., "main:0.0")
    pub async fn attach(jsonl_path: &Path, tmux_target: &str) -> Result<Arc<Self>, SessionError> {
        // Validate JSONL path exists
        if !jsonl_path.exists() {
            return Err(SessionError::JsonlNotFound(
                jsonl_path.display().to_string(),
            ));
        }

        // Validate tmux session is active
        let tmux_check = tokio::process::Command::new("tmux")
            .args(["has-session", "-t", tmux_target])
            .output()
            .await
            .map_err(|e| SessionError::TmuxCommand(e.to_string()))?;

        if !tmux_check.status.success() {
            return Err(SessionError::TmuxNotActive(tmux_target.to_string()));
        }

        let (event_tx, _) = broadcast::channel(SESSION_EVENT_CAPACITY);
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

        let session = Arc::new(Self {
            id: SessionId(Uuid::new_v4()),
            state: AtomicU8::new(STATE_ACTIVE),
            jsonl_path: jsonl_path.to_path_buf(),
            tmux_target: tmux_target.to_string(),
            event_tx: event_tx.clone(),
            shutdown: shutdown_tx,
        });

        // Background task: tail JSONL file for new messages
        let tail_path = jsonl_path.to_path_buf();
        let tail_tx = event_tx.clone();
        let tail_session = Arc::clone(&session);
        let mut tail_shutdown = shutdown_rx;

        tokio::spawn(async move {
            // Start from end of file (only new messages)
            let initial_size = tokio::fs::metadata(&tail_path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            let mut offset = initial_size;

            loop {
                tokio::select! {
                    _ = tail_shutdown.changed() => {
                        if *tail_shutdown.borrow() {
                            debug!(session = %tail_session.id, "JSONL tailing stopped");
                            break;
                        }
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {
                        match parser::parse_incremental(&tail_path, offset).await {
                            Ok((messages, new_offset)) => {
                                if new_offset != offset {
                                    offset = new_offset;
                                    for msg in &messages {
                                        // Determine state from stop_reason
                                        if msg.stop_reason.as_deref() == Some("end_turn") {
                                            tail_session.set_state(SessionState::Idle);
                                            let _ = tail_tx.send(SessionEvent::StateChange(
                                                SessionState::Idle,
                                            ));
                                        } else if msg.stop_reason.is_none()
                                            && msg.message_type == "assistant"
                                        {
                                            tail_session.set_state(SessionState::Active);
                                        }

                                        // Emit content as output event
                                        let text = match &msg.content {
                                            parser::MessageContent::Text(t) => t.clone(),
                                            parser::MessageContent::Blocks(blocks) => {
                                                format!("[{} content blocks]", blocks.len())
                                            }
                                        };
                                        if !text.is_empty() {
                                            let _ = tail_tx
                                                .send(SessionEvent::Output(text));
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                warn!(
                                    session = %tail_session.id,
                                    error = %e,
                                    "JSONL tail parse error"
                                );
                            }
                        }
                    }
                }
            }
        });

        info!(
            session = %session.id,
            jsonl = %jsonl_path.display(),
            tmux = tmux_target,
            "observed session attached"
        );
        Ok(session)
    }

    fn set_state(&self, state: SessionState) {
        let val = match state {
            SessionState::Starting => STATE_STARTING,
            SessionState::Active => STATE_ACTIVE,
            SessionState::Idle => STATE_IDLE,
            SessionState::Error => STATE_ERROR,
            SessionState::Closed => STATE_CLOSED,
        };
        self.state.store(val, Ordering::Relaxed);
    }
}

#[async_trait::async_trait]
impl Session for ObservedSession {
    fn id(&self) -> &SessionId {
        &self.id
    }

    fn mode(&self) -> SessionMode {
        SessionMode::Observed
    }

    fn state(&self) -> SessionState {
        state_from_u8(self.state.load(Ordering::Relaxed))
    }

    async fn send_input(&self, text: &str) -> anyhow::Result<()> {
        let output = tokio::process::Command::new("tmux")
            .args(["send-keys", "-t", &self.tmux_target, text, "Enter"])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux send-keys failed: {}", stderr);
        }

        debug!(
            session = %self.id,
            target = %self.tmux_target,
            bytes = text.len(),
            "sent input via tmux"
        );
        Ok(())
    }

    fn events(&self) -> broadcast::Receiver<SessionEvent> {
        self.event_tx.subscribe()
    }

    async fn close(&self) -> anyhow::Result<()> {
        info!(session = %self.id, "detaching observed session");
        // Signal the tailing task to stop
        let _ = self.shutdown.send(true);
        self.set_state(SessionState::Closed);
        let _ = self.event_tx.send(SessionEvent::Closed);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_roundtrip() {
        for (val, state) in [
            (STATE_STARTING, SessionState::Starting),
            (STATE_ACTIVE, SessionState::Active),
            (STATE_IDLE, SessionState::Idle),
            (STATE_ERROR, SessionState::Error),
            (STATE_CLOSED, SessionState::Closed),
        ] {
            assert_eq!(state_from_u8(val), state);
        }
    }

    #[tokio::test]
    async fn attach_missing_jsonl() {
        let result =
            ObservedSession::attach(Path::new("/nonexistent/session.jsonl"), "test:0.0").await;
        match result {
            Err(e) => assert!(e.to_string().contains("does not exist")),
            Ok(_) => panic!("expected error for missing JSONL path"),
        }
    }

    #[tokio::test]
    async fn attach_invalid_tmux_session() {
        // Create a temporary JSONL file so path validation passes
        let dir = tempfile::tempdir().unwrap();
        let jsonl_path = dir.path().join("test.jsonl");
        tokio::fs::write(&jsonl_path, "{}\n").await.unwrap();

        let result = ObservedSession::attach(&jsonl_path, "nonexistent-tmux-session-12345").await;
        // Should fail because tmux session doesn't exist
        // (or tmux itself isn't running — both are expected failures)
        assert!(result.is_err());
    }
}
