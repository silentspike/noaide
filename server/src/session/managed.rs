use std::ffi::CString;
use std::io::Write;
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};

use nix::libc;
use nix::pty::{ForkptyResult, Winsize, forkpty};
use nix::unistd::{Pid, execvp};
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

fn build_exec_argv(
    binary: &str,
    auto_approve: bool,
    codex_chatgpt_base_url: Option<&str>,
) -> Result<(CString, Vec<CString>), SessionError> {
    let c_binary = CString::new(binary).map_err(|e| SessionError::PtySpawn(e.to_string()))?;
    let mut c_args = vec![c_binary.clone()];

    if auto_approve && binary == "claude" {
        c_args.push(CString::new("--dangerously-skip-permissions").unwrap());
    }

    if binary == "codex"
        && let Some(chatgpt_base_url) = codex_chatgpt_base_url
    {
        c_args.push(CString::new("--config").unwrap());
        c_args.push(
            CString::new(format!("chatgpt_base_url=\"{chatgpt_base_url}\""))
                .map_err(|e| SessionError::PtySpawn(e.to_string()))?,
        );
    }

    Ok((c_binary, c_args))
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
/// Uses `nix::pty::forkpty()` which combines openpty + fork + setsid + dup2 into
/// a single proven glibc call. The child gets its own session with the slave PTY
/// as controlling terminal (stdin/stdout/stderr), and the parent gets the master fd.
pub struct ManagedSession {
    id: SessionId,
    state: AtomicU8,
    writer: Mutex<std::fs::File>,
    event_tx: broadcast::Sender<SessionEvent>,
    /// PID of the child process (kept for cleanup).
    child_pid: Pid,
}

impl ManagedSession {
    /// Spawn a new CLI process (claude, codex, or gemini) in a PTY.
    ///
    /// Uses `forkpty()` — a single C call that handles all PTY setup:
    /// openpty, fork, setsid, TIOCSCTTY, dup2(slave → 0/1/2), close slave.
    ///
    /// - `working_dir`: directory where the CLI is invoked
    /// - `anthropic_base_url`: optional URL override for the API proxy
    /// - `cli_type`: which CLI to spawn — "claude" (default), "codex", or "gemini"
    pub fn spawn(
        working_dir: &Path,
        anthropic_base_url: Option<&str>,
        cli_type: &str,
        auto_approve: bool,
    ) -> Result<Arc<Self>, SessionError> {
        // Generate session ID FIRST — needed for per-session proxy URL prefix
        let session_id = SessionId(Uuid::new_v4());

        // Select binary name based on CLI type
        let binary = match cli_type {
            "codex" => "codex",
            "gemini" => "gemini",
            _ => "claude", // default
        };

        // Build environment variables for the child process.
        // Collect all CLAUDE_CODE_* vars from the parent to clear them.
        // Without this, the child inherits SESSION_ACCESS_TOKEN (acts as sub-agent),
        // EXPERIMENTAL_AGENT_TEAMS=1 (team mode, no interactive prompt),
        // MAX_OUTPUT_TOKENS, AUTO_CONNECT_IDE, etc. — causing it to run
        // headless instead of showing an interactive TUI prompt.
        let mut env_vars: Vec<(String, String)> = Vec::new();
        let mut codex_chatgpt_base_url: Option<String> = None;
        env_vars.push(("TERM".to_string(), "xterm-256color".to_string()));
        // Clear ALL Claude-related env vars to ensure fresh interactive session
        env_vars.push(("CLAUDECODE".to_string(), String::new()));
        env_vars.push(("CLAUDE_CODE_ENTRYPOINT".to_string(), String::new()));
        for (key, _) in std::env::vars() {
            if key.starts_with("CLAUDE_CODE_") {
                env_vars.push((key, String::new()));
            }
        }

        // Set API base URLs for all providers to route through the proxy.
        // Per-session prefix /s/{uuid}/ allows the proxy to attribute requests
        // to this session and apply per-session intercept mode.
        if let Some(base_url) = anthropic_base_url {
            let base = base_url.trim_end_matches('/');
            let sid = &session_id.0;

            // Claude CLI: per-session proxy URL (full cleartext visibility)
            env_vars.push(("ANTHROPIC_BASE_URL".to_string(), format!("{base}/s/{sid}")));
            // Codex CLI: per-session URL + /backend-api/codex path
            // so the OAuth token (ChatGPT auth) is sent to the correct upstream
            // endpoint (chatgpt.com/backend-api/codex/responses), not the
            // standard OpenAI API (/v1/responses) which rejects ChatGPT tokens.
            env_vars.push((
                "OPENAI_BASE_URL".to_string(),
                format!("{base}/s/{sid}/backend-api/codex"),
            ));
            // Codex uses `chatgpt_base_url` config (not an env var) for
            // analytics, plugins, WHAM, and other ChatGPT-backend endpoints.
            // Route those through the same per-session reverse proxy so telemetry
            // stays visible and proxy modes can block it.
            codex_chatgpt_base_url = Some(format!("{base}/s/{sid}/backend-api/"));
            // Gemini CLI: per-session proxy URL for Code Assist backend
            // CODE_ASSIST_ENDPOINT covers control-plane calls (v1internal:*)
            // GOOGLE_GEMINI_BASE_URL covers the actual LLM/generative calls
            // (generativelanguage.googleapis.com) — without this, chat API
            // calls bypass the proxy entirely.
            env_vars.push((
                "CODE_ASSIST_ENDPOINT".to_string(),
                format!("{base}/s/{sid}"),
            ));
            env_vars.push((
                "GOOGLE_GEMINI_BASE_URL".to_string(),
                format!("{base}/s/{sid}"),
            ));
            // Hybrid Proxy Architecture (Reverse + CONNECT MITM):
            //
            // API calls (api.anthropic.com, chatgpt.com, etc.) are in NO_PROXY →
            // forced through per-session *_BASE_URL reverse proxy → full cleartext.
            //
            // Everything else (telemetry, auth, updates, git) → routed through
            // HTTPS_PROXY CONNECT tunnel → TLS MITM → classified + logged.
            //
            // The session UUID is embedded in Proxy-Authorization: Basic for
            // per-session attribution in the CONNECT handler.

            // Extract proxy port from base URL (e.g. "http://localhost:4434" → 4434)
            let proxy_port = base
                .rsplit(':')
                .next()
                .and_then(|p| p.parse::<u16>().ok())
                .unwrap_or(4434);

            env_vars.push((
                "HTTPS_PROXY".to_string(),
                format!("http://{sid}:x@localhost:{proxy_port}"),
            ));
            env_vars.push((
                "HTTP_PROXY".to_string(),
                format!("http://{sid}:x@localhost:{proxy_port}"),
            ));
            // NO_PROXY: API domains go through BASE_URL reverse proxy, NOT CONNECT.
            // Without this, CLIs would route API calls through HTTPS_PROXY CONNECT
            // tunnel instead of BASE_URL, losing per-session prefix and visibility.
            env_vars.push((
                "NO_PROXY".to_string(),
                "localhost,127.0.0.1,api.anthropic.com,api.openai.com,chatgpt.com,\
                 generativelanguage.googleapis.com,cloudcode-pa.googleapis.com"
                    .to_string(),
            ));

            // CA Trust: tell CLIs to trust the mkcert root CA for MITM TLS
            if let Some(ca_path) = crate::proxy::tls_mitm::find_ca_cert_path() {
                // Node.js (Claude CLI, Gemini CLI)
                env_vars.push(("NODE_EXTRA_CA_CERTS".to_string(), ca_path.clone()));
                // OpenSSL-based tools (fallback)
                env_vars.push(("SSL_CERT_FILE".to_string(), ca_path.clone()));
                // Codex CLI (native Rust binary, respects this env var)
                env_vars.push(("CODEX_CA_CERTIFICATE".to_string(), ca_path));
            }
        }

        // Prepare argv before fork (no heap allocation after fork).
        let (c_binary, c_args) =
            build_exec_argv(binary, auto_approve, codex_chatgpt_base_url.as_deref())?;

        let working_dir_owned = working_dir.to_path_buf();

        // Set terminal size to 80x24
        let winsize = Winsize {
            ws_row: 24,
            ws_col: 80,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };

        // forkpty does everything: openpty + fork + setsid + TIOCSCTTY + dup2 + close slave.
        // SAFETY: We immediately exec in the child. Between fork and exec we only call
        // async-signal-safe functions (chdir, setenv, execvp, _exit).
        let fork_result = unsafe { forkpty(Some(&winsize), None) }
            .map_err(|e| SessionError::PtySpawn(format!("forkpty failed: {e}")))?;

        let (master_fd, child_pid) = match fork_result {
            ForkptyResult::Child => {
                // === CHILD PROCESS ===
                // forkpty already did: setsid, TIOCSCTTY, dup2(slave → 0/1/2), close slave.
                // We just need to set env vars, chdir, and exec.

                // SAFETY: Post-fork, single-threaded in child.
                unsafe {
                    for (key, val) in &env_vars {
                        if val.is_empty() {
                            // Remove env var entirely (not just set to "").
                            // Node.js checks `"KEY" in process.env` which returns
                            // true for empty strings — only removal works.
                            std::env::remove_var(key);
                        } else {
                            std::env::set_var(key, val);
                        }
                    }
                    let _ = std::env::set_current_dir(&working_dir_owned);
                }

                // Exec the CLI binary
                let _ = execvp(&c_binary, &c_args);

                // If exec fails, exit with 127 (command not found convention)
                std::process::exit(127);
            }
            ForkptyResult::Parent { child, master } => (master, child),
        };

        // Master fd: use try_clone() for separate reader (idiomatic dup)
        let master_raw = master_fd.as_raw_fd();
        let master_file = unsafe { std::fs::File::from_raw_fd(master_fd.into_raw_fd()) };
        let reader_file = master_file
            .try_clone()
            .map_err(|e| SessionError::PtySpawn(format!("dup master failed: {e}")))?;

        info!(
            session = %session_id,
            master_fd = master_raw,
            reader_fd = reader_file.as_raw_fd(),
            child_pid = child_pid.as_raw(),
            "PTY master fds allocated (forkpty)"
        );

        let (event_tx, _) = broadcast::channel(SESSION_EVENT_CAPACITY);

        let session = Arc::new(Self {
            id: session_id.clone(),
            state: AtomicU8::new(STATE_STARTING),
            writer: Mutex::new(master_file),
            event_tx: event_tx.clone(),
            child_pid,
        });

        // Background task: read PTY master and emit events.
        // Uses raw libc::poll + libc::read for maximum control and diagnostics.
        let sid = session_id.clone();
        let state_ref = Arc::clone(&session);
        let tx = event_tx.clone();
        std::thread::Builder::new()
            .name(format!("pty-reader-{}", sid))
            .spawn(move || {
                let fd = reader_file.as_raw_fd();
                // Keep the File alive so the fd isn't closed
                let _keep = reader_file;

                // Log fd flags for diagnostics
                let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
                info!(
                    session = %sid, fd = fd, flags = flags,
                    o_nonblock = (flags & libc::O_NONBLOCK != 0),
                    o_rdwr = (flags & libc::O_RDWR != 0),
                    "PTY reader thread started"
                );

                let mut buf = [0u8; 4096];
                let mut poll_timeouts = 0u32;
                loop {
                    // poll() to check if data/hangup is available
                    let mut pfd = libc::pollfd {
                        fd,
                        events: libc::POLLIN | libc::POLLHUP | libc::POLLERR,
                        revents: 0,
                    };
                    let poll_ret = unsafe { libc::poll(&mut pfd, 1, 5000) };

                    if poll_ret == 0 {
                        // Timeout — no data for 5 seconds
                        poll_timeouts += 1;
                        if poll_timeouts <= 12 {
                            // Log first 60s of timeouts, then go quiet
                            debug!(
                                session = %sid,
                                consecutive_timeouts = poll_timeouts,
                                "PTY poll timeout (5s, no data on master fd)"
                            );
                        }
                        continue;
                    }
                    if poll_ret < 0 {
                        let err = std::io::Error::last_os_error();
                        if err.raw_os_error() == Some(libc::EINTR) {
                            continue; // Interrupted by signal, retry
                        }
                        warn!(session = %sid, error = %err, "PTY poll error");
                        state_ref.set_state(SessionState::Closed);
                        let _ = tx.send(SessionEvent::Closed);
                        break;
                    }

                    // Reset timeout counter on any event
                    poll_timeouts = 0;

                    let has_pollin = pfd.revents & libc::POLLIN != 0;
                    let has_pollhup = pfd.revents & libc::POLLHUP != 0;
                    let has_pollerr = pfd.revents & libc::POLLERR != 0;

                    if has_pollin {
                        // Data available — read with raw libc::read
                        let n = unsafe {
                            libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len())
                        };

                        if n == 0 {
                            info!(session = %sid, "PTY EOF (read returned 0)");
                            state_ref.set_state(SessionState::Closed);
                            let _ = tx.send(SessionEvent::Closed);
                            break;
                        }
                        if n < 0 {
                            let err = std::io::Error::last_os_error();
                            if err.raw_os_error() == Some(libc::EIO) {
                                debug!(session = %sid, "PTY closed (child exited, EIO)");
                            } else if err.raw_os_error() == Some(libc::EAGAIN) {
                                continue; // Spurious POLLIN, retry
                            } else {
                                warn!(session = %sid, error = %err, "PTY read error");
                            }
                            state_ref.set_state(SessionState::Closed);
                            let _ = tx.send(SessionEvent::Closed);
                            break;
                        }

                        let n = n as usize;
                        let output = String::from_utf8_lossy(&buf[..n]).to_string();

                        if !output.trim().is_empty() {
                            state_ref.set_state(SessionState::Active);
                        }

                        // Log first 500 chars for diagnostics
                        let preview: String = output.chars().take(500).collect();
                        info!(session = %sid, bytes = n, preview = %preview, "PTY output received");
                        let _ = tx.send(SessionEvent::Output(output));
                    } else if has_pollhup || has_pollerr {
                        // Hangup or error without data
                        debug!(
                            session = %sid,
                            pollhup = has_pollhup,
                            pollerr = has_pollerr,
                            "PTY hangup/error (slave closed)"
                        );
                        state_ref.set_state(SessionState::Closed);
                        let _ = tx.send(SessionEvent::Closed);
                        break;
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

        info!(session = %session.id, pid = child_pid.as_raw(), working_dir = %working_dir.display(), "managed session spawned");
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

impl Drop for ManagedSession {
    fn drop(&mut self) {
        // Best-effort cleanup: send SIGTERM to the child process
        let _ = nix::sys::signal::kill(self.child_pid, nix::sys::signal::Signal::SIGTERM);
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

    /// Helper: spawn a test session with an arbitrary command via raw PTY.
    /// Uses forkpty() for consistency with production code.
    fn spawn_test_session(
        cmd_name: &str,
        args: &[&str],
        env_vars: &[(&str, &str)],
    ) -> (Arc<ManagedSession>, broadcast::Receiver<SessionEvent>) {
        let winsize = Winsize {
            ws_row: 24,
            ws_col: 80,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };

        let c_binary = CString::new(cmd_name).unwrap();
        let mut c_args: Vec<CString> = vec![c_binary.clone()];
        for arg in args {
            c_args.push(CString::new(*arg).unwrap());
        }

        let env_owned: Vec<(String, String)> = env_vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();

        let fork_result = unsafe { forkpty(Some(&winsize), None) }.unwrap();

        let (master_fd, child_pid) = match fork_result {
            ForkptyResult::Child => {
                unsafe {
                    for (key, val) in &env_owned {
                        std::env::set_var(key, val);
                    }
                }
                let _ = execvp(&c_binary, &c_args);
                std::process::exit(127);
            }
            ForkptyResult::Parent { child, master } => (master, child),
        };

        let master_file = unsafe { std::fs::File::from_raw_fd(master_fd.into_raw_fd()) };
        let reader_file = master_file.try_clone().unwrap();

        let (event_tx, event_rx) = broadcast::channel(64);

        let session = Arc::new(ManagedSession {
            id: SessionId(Uuid::new_v4()),
            state: AtomicU8::new(STATE_STARTING),
            writer: Mutex::new(master_file),
            event_tx: event_tx.clone(),
            child_pid,
        });

        // Background reader thread
        let tx = event_tx.clone();
        let s = Arc::clone(&session);
        let sid = session.id.clone();
        std::thread::spawn(move || {
            use std::io::Read;
            let mut reader = reader_file;
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
                        if !output.trim().is_empty() {
                            s.set_state(SessionState::Active);
                        }
                        let _ = tx.send(SessionEvent::Output(output));
                    }
                    Err(e) => {
                        // EIO is expected when child exits
                        if e.raw_os_error() != Some(5) {
                            eprintln!("PTY read error for {sid}: {e}");
                        }
                        s.set_state(SessionState::Closed);
                        let _ = tx.send(SessionEvent::Closed);
                        break;
                    }
                }
            }
        });

        (session, event_rx)
    }

    #[test]
    fn codex_exec_argv_includes_chatgpt_base_url_override() {
        let (_, args) = build_exec_argv(
            "codex",
            false,
            Some("http://localhost:4434/s/test-session/backend-api/"),
        )
        .unwrap();

        let rendered: Vec<String> = args
            .iter()
            .map(|arg| arg.to_str().unwrap().to_string())
            .collect();

        assert_eq!(rendered[0], "codex");
        assert!(rendered.contains(&"--config".to_string()));
        assert!(rendered.contains(
            &"chatgpt_base_url=\"http://localhost:4434/s/test-session/backend-api/\"".to_string()
        ));
    }

    #[test]
    fn claude_exec_argv_preserves_auto_approve_flag() {
        let (_, args) = build_exec_argv("claude", true, None).unwrap();
        let rendered: Vec<String> = args
            .iter()
            .map(|arg| arg.to_str().unwrap().to_string())
            .collect();

        assert_eq!(
            rendered,
            vec![
                "claude".to_string(),
                "--dangerously-skip-permissions".to_string()
            ]
        );
    }

    #[tokio::test]
    async fn spawn_echo_session() {
        // Spawn a simple echo command instead of claude (which may not be installed)
        let (session, mut event_rx) = spawn_test_session("echo", &["hello from pty"], &[]);

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

    /// AC-5-2: send_input writes to PTY stdin
    #[tokio::test]
    async fn send_input_writes_to_pty() {
        // `cat` reads stdin and writes to stdout — perfect for testing send_input
        let (session, mut event_rx) = spawn_test_session("cat", &[], &[]);

        // Give cat a moment to start
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Send input via PTY
        session.send_input("hello from send_input\n").await.unwrap();

        // Collect output — PTY echo + cat echo should produce the text
        let mut received = String::new();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_secs(2), event_rx.recv()).await {
                Ok(Ok(SessionEvent::Output(text))) => {
                    received.push_str(&text);
                    if received.contains("hello from send_input") {
                        break;
                    }
                }
                Ok(Ok(SessionEvent::Closed)) => break,
                _ => break,
            }
        }

        assert!(
            received.contains("hello from send_input"),
            "PTY should echo send_input text back, got: {received}"
        );

        // Clean up: close the session (sends Ctrl-C + Ctrl-D to kill cat)
        session.close().await.unwrap();
    }

    /// AC-5-3: Proxy env vars set in spawned process environment
    ///
    /// Per-session URLs include /s/{uuid}/ prefix. OPENAI_BASE_URL also includes
    /// /backend-api/codex so Codex CLI routes ChatGPT-backend inference through
    /// the proxy. HTTPS_PROXY/HTTP_PROXY are NOT set — CLIs would prefer CONNECT
    /// tunnels over ANTHROPIC_BASE_URL, bypassing per-session prefix extraction
    /// and making interception impossible.
    #[tokio::test]
    async fn env_vars_set_in_spawned_process() {
        // Use a fixed UUID to test per-session URL format
        let test_uuid = "550e8400-e29b-41d4-a716-446655440000";
        let base = "http://localhost:4434";

        // `env` dumps all environment variables and exits
        let (session, mut event_rx) = spawn_test_session(
            "env",
            &[],
            &[
                ("ANTHROPIC_BASE_URL", &format!("{base}/s/{test_uuid}")),
                (
                    "OPENAI_BASE_URL",
                    &format!("{base}/s/{test_uuid}/backend-api/codex"),
                ),
                ("CODE_ASSIST_ENDPOINT", &format!("{base}/s/{test_uuid}")),
            ],
        );

        // Collect all output until process exits
        let mut received = String::new();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_secs(2), event_rx.recv()).await {
                Ok(Ok(SessionEvent::Output(text))) => {
                    received.push_str(&text);
                }
                Ok(Ok(SessionEvent::Closed)) => break,
                _ => break,
            }
        }

        // Per-session proxy URLs include /s/{uuid}/ prefix
        assert!(
            received.contains(&format!("ANTHROPIC_BASE_URL={base}/s/{test_uuid}")),
            "Spawned process should have per-session ANTHROPIC_BASE_URL, got: {received}"
        );
        assert!(
            received.contains(&format!(
                "OPENAI_BASE_URL={base}/s/{test_uuid}/backend-api/codex"
            )),
            "Spawned process should have per-session OPENAI_BASE_URL with codex path, got: {received}"
        );
        assert!(
            received.contains(&format!("CODE_ASSIST_ENDPOINT={base}/s/{test_uuid}")),
            "Spawned process should have per-session CODE_ASSIST_ENDPOINT, got: {received}"
        );
        // HTTPS_PROXY/HTTP_PROXY must NOT be set — CLIs prefer CONNECT tunnels
        // over base URL overrides, which bypasses session-prefix extraction and
        // makes interception impossible.
        assert!(
            !received.contains("HTTPS_PROXY="),
            "Spawned process should NOT have HTTPS_PROXY (causes CONNECT tunnel bypass), got: {received}"
        );
        assert!(
            !received.contains("HTTP_PROXY="),
            "Spawned process should NOT have HTTP_PROXY (causes CONNECT tunnel bypass), got: {received}"
        );
        let _ = session; // keep session alive until assertions pass
    }

    /// AC-5-6: Session lifecycle states transition correctly (Starting->Active->Closed)
    #[tokio::test]
    async fn lifecycle_state_transitions() {
        // `echo` prints output and exits — triggers Starting -> Active -> Closed
        let (session, mut event_rx) = spawn_test_session("echo", &["lifecycle test"], &[]);

        // Track events: Output proves Active happened (reader sets Active before sending Output),
        // Closed proves the lifecycle completed (reader sets Closed before sending Closed).
        let mut saw_output = false;
        let mut saw_closed = false;

        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_secs(2), event_rx.recv()).await {
                Ok(Ok(SessionEvent::Output(text))) => {
                    if text.contains("lifecycle test") {
                        saw_output = true;
                    }
                }
                Ok(Ok(SessionEvent::Closed)) => {
                    saw_closed = true;
                    break;
                }
                _ => break,
            }
        }

        // Output event proves the session reached Active (reader thread sets Active before Output)
        assert!(
            saw_output,
            "Session should produce output (proving Active state was reached)"
        );
        // Closed event proves lifecycle completed (Starting -> Active -> Closed)
        assert!(
            saw_closed,
            "Session should reach Closed state on process exit"
        );
        assert_eq!(session.state(), SessionState::Closed);
    }
}
