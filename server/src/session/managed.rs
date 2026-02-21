use std::io::{Read as _, Write};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tokio::sync::{Mutex, broadcast};
use tracing::{debug, info, warn};
use uuid::Uuid;

use super::types::{
    SESSION_EVENT_CAPACITY, Session, SessionError, SessionEvent, SessionId, SessionMode,
    SessionState,
};

/// State encoding for AtomicU8.
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

/// PTY output patterns used to detect Breathing Orb state.
/// Currently used in tests; will drive fine-grained state detection in WP-9.
#[allow(dead_code)]
mod patterns {
    /// Braille spinner characters → THINKING state.
    pub const BRAILLE_CHARS: &[char] = &['\u{280B}', '\u{2819}', '\u{2839}', '\u{2838}'];

    /// Check if output contains a braille spinner pattern.
    pub fn is_thinking(output: &str) -> bool {
        output.chars().any(|c| BRAILLE_CHARS.contains(&c))
    }

    /// Check if output looks like tool use (Read, Edit, Bash, etc.).
    pub fn is_tool_use(output: &str) -> bool {
        // Tool names appear in PTY output as "⏺ Read(...)" etc.
        let tool_markers = [
            "Read(", "Edit(", "Bash(", "Write(", "Glob(", "Grep(", "Task(", "LSP(",
        ];
        tool_markers.iter().any(|m| output.contains(m))
    }
}

/// A managed session: IDE spawns `claude` process via PTY.
///
/// Full stdin/stdout access. The `ANTHROPIC_BASE_URL` environment variable
/// is set to redirect API calls through the noaide proxy.
pub struct ManagedSession {
    id: SessionId,
    state: AtomicU8,
    writer: Mutex<Box<dyn Write + Send>>,
    event_tx: broadcast::Sender<SessionEvent>,
    /// Handle to the child process (kept alive).
    _child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

impl ManagedSession {
    /// Spawn a new Claude Code process in a PTY.
    ///
    /// - `working_dir`: directory where `claude` is invoked
    /// - `anthropic_base_url`: optional URL override for the API proxy
    pub fn spawn(
        working_dir: &Path,
        anthropic_base_url: Option<&str>,
    ) -> Result<Arc<Self>, SessionError> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::PtySpawn(e.to_string()))?;

        let mut cmd = CommandBuilder::new("claude");
        cmd.cwd(working_dir);

        // Set ANTHROPIC_BASE_URL for API proxy integration
        if let Some(base_url) = anthropic_base_url {
            cmd.env("ANTHROPIC_BASE_URL", base_url);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| SessionError::PtySpawn(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| SessionError::PtySpawn(e.to_string()))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| SessionError::PtySpawn(e.to_string()))?;

        let session_id = SessionId(Uuid::new_v4());
        let (event_tx, _) = broadcast::channel(SESSION_EVENT_CAPACITY);

        let session = Arc::new(Self {
            id: session_id.clone(),
            state: AtomicU8::new(STATE_STARTING),
            writer: Mutex::new(writer),
            event_tx: event_tx.clone(),
            _child: Mutex::new(child),
        });

        // Background task: read PTY stdout and emit events
        let sid = session_id.clone();
        let state_ref = Arc::clone(&session);
        let tx = event_tx.clone();
        std::thread::Builder::new()
            .name(format!("pty-reader-{}", sid))
            .spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            // EOF — process exited
                            info!(session = %sid, "PTY EOF, process exited");
                            state_ref.set_state(SessionState::Closed);
                            let _ = tx.send(SessionEvent::Closed);
                            break;
                        }
                        Ok(n) => {
                            let output = String::from_utf8_lossy(&buf[..n]).to_string();

                            // Any non-empty output means session is active
                            // (tool use, thinking spinner, or streaming text)
                            if !output.trim().is_empty() {
                                state_ref.set_state(SessionState::Active);
                            }

                            let _ = tx.send(SessionEvent::Output(output));
                        }
                        Err(e) => {
                            warn!(session = %sid, error = %e, "PTY read error");
                            state_ref.set_state(SessionState::Error);
                            let _ = tx.send(SessionEvent::Error(e.to_string()));
                            break;
                        }
                    }
                }
            })
            .map_err(|e| SessionError::PtySpawn(e.to_string()))?;

        // Idle detection task: if no output for >2 seconds, transition to Idle
        let idle_session = Arc::clone(&session);
        let mut idle_rx = event_tx.subscribe();
        tokio::spawn(async move {
            loop {
                match tokio::time::timeout(std::time::Duration::from_secs(2), idle_rx.recv()).await
                {
                    Ok(Ok(SessionEvent::Output(_))) => {
                        // Got output, reset idle timer (loop continues)
                    }
                    Ok(Ok(SessionEvent::Closed)) | Ok(Err(_)) => break,
                    Ok(Ok(_)) => {}
                    Err(_) => {
                        // Timeout: no output for 2 seconds
                        let current = idle_session.state.load(Ordering::Relaxed);
                        if current == STATE_ACTIVE || current == STATE_STARTING {
                            idle_session.set_state(SessionState::Idle);
                            let _ = idle_session
                                .event_tx
                                .send(SessionEvent::StateChange(SessionState::Idle));
                            debug!(session = %idle_session.id, "session idle (no output >2s)");
                        }
                    }
                }
            }
        });

        info!(session = %session.id, working_dir = %working_dir.display(), "managed session spawned");
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
impl Session for ManagedSession {
    fn id(&self) -> &SessionId {
        &self.id
    }

    fn mode(&self) -> SessionMode {
        SessionMode::Managed
    }

    fn state(&self) -> SessionState {
        state_from_u8(self.state.load(Ordering::Relaxed))
    }

    async fn send_input(&self, text: &str) -> anyhow::Result<()> {
        let mut writer = self.writer.lock().await;
        writer.write_all(text.as_bytes())?;
        writer.flush()?;
        debug!(session = %self.id, bytes = text.len(), "sent input to PTY");
        Ok(())
    }

    fn events(&self) -> broadcast::Receiver<SessionEvent> {
        self.event_tx.subscribe()
    }

    async fn close(&self) -> anyhow::Result<()> {
        info!(session = %self.id, "closing managed session");
        // Send Ctrl-C then Ctrl-D to gracefully terminate
        {
            let mut writer = self.writer.lock().await;
            let _ = writer.write_all(b"\x03"); // Ctrl-C
            let _ = writer.flush();
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        {
            let mut writer = self.writer.lock().await;
            let _ = writer.write_all(b"\x04"); // Ctrl-D (EOF)
            let _ = writer.flush();
        }
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

    #[test]
    fn unknown_state_maps_to_error() {
        assert_eq!(state_from_u8(255), SessionState::Error);
    }

    #[test]
    fn pattern_thinking_detection() {
        assert!(patterns::is_thinking("\u{280B}"));
        assert!(patterns::is_thinking("working \u{2819} loading"));
        assert!(!patterns::is_thinking("normal output"));
    }

    #[test]
    fn pattern_tool_detection() {
        assert!(patterns::is_tool_use("Read(file.rs)"));
        assert!(patterns::is_tool_use("running Bash(ls -la)"));
        assert!(!patterns::is_tool_use("just some text output"));
    }

    #[tokio::test]
    async fn spawn_echo_session() {
        // Spawn a simple echo command instead of claude (which may not be installed)
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();

        let mut cmd = CommandBuilder::new("echo");
        cmd.arg("hello from pty");
        let child = pair.slave.spawn_command(cmd).unwrap();

        let writer = pair.master.take_writer().unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();

        let (event_tx, mut event_rx) = broadcast::channel(16);

        let session = Arc::new(ManagedSession {
            id: SessionId(Uuid::new_v4()),
            state: AtomicU8::new(STATE_STARTING),
            writer: Mutex::new(writer),
            event_tx: event_tx.clone(),
            _child: Mutex::new(child),
        });

        // Read output in background
        let tx = event_tx.clone();
        let s = Arc::clone(&session);
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        s.set_state(SessionState::Closed);
                        let _ = tx.send(SessionEvent::Closed);
                        break;
                    }
                    Ok(n) => {
                        let output = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = tx.send(SessionEvent::Output(output));
                    }
                    Err(_) => break,
                }
            }
        });

        // Wait for output
        let mut got_output = false;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_secs(2), event_rx.recv()).await {
                Ok(Ok(SessionEvent::Output(text))) => {
                    if text.contains("hello from pty") {
                        got_output = true;
                        break;
                    }
                }
                Ok(Ok(SessionEvent::Closed)) => break,
                _ => break,
            }
        }
        assert!(got_output, "should receive 'hello from pty' output");
        assert_eq!(session.mode(), SessionMode::Managed);
    }
}
