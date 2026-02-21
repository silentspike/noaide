use std::path::{Path, PathBuf};
use std::time::SystemTime;

use tokio::sync::broadcast;
use tracing::{debug, info, warn};

/// Metadata about a discovered JSONL session file.
#[derive(Debug, Clone)]
pub struct SessionInfo {
    /// Session UUID extracted from filename.
    pub id: String,
    /// Full path to the .jsonl file.
    pub jsonl_path: PathBuf,
    /// Decoded project path (e.g., `/work/noaide`).
    pub project_path: Option<PathBuf>,
    /// Last modified time.
    pub last_modified: SystemTime,
    /// File size in bytes.
    pub size_bytes: u64,
}

/// Info about a discovered subagent JSONL file.
#[derive(Debug, Clone)]
pub struct SubagentInfo {
    /// Agent ID (e.g., `a08ef36`).
    pub agent_id: String,
    /// Full path to the subagent .jsonl file.
    pub jsonl_path: PathBuf,
    /// Parent session ID.
    pub session_id: String,
}

/// Recursive JSONL session scanner.
///
/// Scans `~/.claude/projects/` for session JSONL files and their
/// associated subagent files.
pub struct SessionScanner {
    tx: broadcast::Sender<SessionInfo>,
}

impl SessionScanner {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self { tx }
    }

    /// Scan a claude directory for all JSONL session files.
    ///
    /// Expected structure:
    /// ```text
    /// {claude_dir}/projects/{project-dir}/{session-uuid}.jsonl
    /// {claude_dir}/projects/{project-dir}/{session-uuid}/subagents/agent-{id}.jsonl
    /// ```
    pub async fn scan(claude_dir: &Path) -> anyhow::Result<Vec<SessionInfo>> {
        let projects_dir = claude_dir.join("projects");
        if !projects_dir.exists() {
            info!(path = %projects_dir.display(), "projects directory not found");
            return Ok(Vec::new());
        }

        let mut sessions = Vec::new();
        let mut project_entries = tokio::fs::read_dir(&projects_dir).await?;

        while let Some(project_entry) = project_entries.next_entry().await? {
            if !project_entry.file_type().await?.is_dir() {
                continue;
            }

            let project_dir_name = project_entry.file_name().to_string_lossy().to_string();
            let project_path = decode_project_dir(&project_dir_name);
            let project_dir = project_entry.path();

            match Self::scan_project_dir(&project_dir, &project_path).await {
                Ok(project_sessions) => sessions.extend(project_sessions),
                Err(e) => {
                    warn!(
                        project = %project_dir.display(),
                        error = %e,
                        "failed to scan project directory"
                    );
                }
            }
        }

        // Also scan todos directory
        let todos_dir = claude_dir.join("todos");
        if todos_dir.exists() {
            debug!(path = %todos_dir.display(), "scanning todos directory");
            // todos/ contains .json files, not .jsonl — skip for now
        }

        info!(count = sessions.len(), "session discovery complete");
        Ok(sessions)
    }

    async fn scan_project_dir(
        project_dir: &Path,
        project_path: &str,
    ) -> anyhow::Result<Vec<SessionInfo>> {
        let mut sessions = Vec::new();
        let mut entries = tokio::fs::read_dir(project_dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            let file_name = entry.file_name().to_string_lossy().to_string();

            // Only process .jsonl files (not directories, not .json)
            if !file_name.ends_with(".jsonl") {
                continue;
            }

            let session_id = file_name.trim_end_matches(".jsonl").to_string();

            // Validate UUID format
            if uuid::Uuid::parse_str(&session_id).is_err() {
                debug!(file = %file_name, "skipping non-UUID JSONL file");
                continue;
            }

            let metadata = match entry.metadata().await {
                Ok(m) => m,
                Err(e) => {
                    warn!(file = %file_name, error = %e, "failed to read metadata");
                    continue;
                }
            };

            sessions.push(SessionInfo {
                id: session_id,
                jsonl_path: entry.path(),
                project_path: Some(PathBuf::from(project_path)),
                last_modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                size_bytes: metadata.len(),
            });
        }

        Ok(sessions)
    }

    /// Scan for subagent JSONL files associated with a session.
    pub async fn scan_subagents(
        claude_dir: &Path,
        project_dir_name: &str,
        session_id: &str,
    ) -> Vec<SubagentInfo> {
        let subagents_dir = claude_dir
            .join("projects")
            .join(project_dir_name)
            .join(session_id)
            .join("subagents");

        if !subagents_dir.exists() {
            return Vec::new();
        }

        let mut agents = Vec::new();
        let Ok(mut entries) = tokio::fs::read_dir(&subagents_dir).await else {
            return Vec::new();
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".jsonl") {
                continue;
            }

            let agent_id = name
                .trim_start_matches("agent-")
                .trim_end_matches(".jsonl")
                .to_string();

            agents.push(SubagentInfo {
                agent_id,
                jsonl_path: entry.path(),
                session_id: session_id.to_string(),
            });
        }

        agents
    }

    /// Get a receiver for new session notifications.
    ///
    /// New sessions are broadcast when `notify_new_session` is called
    /// (typically from the watcher event loop when a new .jsonl file appears).
    pub fn watch_new_sessions(&self) -> broadcast::Receiver<SessionInfo> {
        self.tx.subscribe()
    }

    /// Notify watchers about a newly discovered session.
    pub fn notify_new_session(&self, info: SessionInfo) {
        let _ = self.tx.send(info);
    }
}

/// Decode a Claude Code project directory name back to a filesystem path.
///
/// Claude Code encodes paths by replacing `/` with `-` and prepending `-`.
///
/// Examples:
/// - `-work-noaide` → `/work/noaide`
/// - `-home-jan` → `/home/jan`
/// - `-work-company--sentinel-tools` → `/work/company/-sentinel-tools`
///
/// Double dashes represent a literal dash in the original path component.
fn decode_project_dir(encoded: &str) -> String {
    let without_prefix = encoded.strip_prefix('-').unwrap_or(encoded);
    let mut result = String::with_capacity(without_prefix.len() + 1);
    result.push('/');

    let mut chars = without_prefix.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '-' {
            if chars.peek() == Some(&'-') {
                // Double dash: literal dash in path
                chars.next();
                result.push('-');
            } else {
                // Single dash: path separator
                result.push('/');
            }
        } else {
            result.push(c);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn decode_simple_path() {
        assert_eq!(decode_project_dir("-work-noaide"), "/work/noaide");
    }

    #[test]
    fn decode_home_path() {
        assert_eq!(decode_project_dir("-home-jan"), "/home/jan");
    }

    #[test]
    fn decode_double_dash() {
        // Double dash `--` in encoded form = literal `-` in path component
        assert_eq!(
            decode_project_dir("-work-company--sentinel-tools"),
            "/work/company-sentinel/tools"
        );
    }

    #[test]
    fn decode_root_path() {
        assert_eq!(decode_project_dir("-work"), "/work");
    }

    #[tokio::test]
    async fn scan_finds_sessions() {
        let dir = TempDir::new().unwrap();
        let projects_dir = dir.path().join("projects").join("-test-project");
        fs::create_dir_all(&projects_dir).unwrap();

        // Create valid session JSONL files
        fs::write(
            projects_dir.join("a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl"),
            r#"{"type":"user","message":{"role":"user","content":"hello"},"uuid":"1"}"#,
        )
        .unwrap();
        fs::write(
            projects_dir.join("b2c3d4e5-f6a7-8901-bcde-f12345678901.jsonl"),
            r#"{"type":"user","message":{"role":"user","content":"world"},"uuid":"2"}"#,
        )
        .unwrap();

        // Create a non-UUID file (should be skipped)
        fs::write(
            projects_dir.join("sessions-index.jsonl"),
            "not a session",
        )
        .unwrap();

        let sessions = SessionScanner::scan(dir.path()).await.unwrap();
        assert_eq!(sessions.len(), 2);

        // All sessions should have the decoded project path
        for s in &sessions {
            assert_eq!(s.project_path, Some(PathBuf::from("/test/project")));
            assert!(s.size_bytes > 0);
        }
    }

    #[tokio::test]
    async fn scan_empty_dir() {
        let dir = TempDir::new().unwrap();
        let sessions = SessionScanner::scan(dir.path()).await.unwrap();
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn scan_missing_dir() {
        let sessions = SessionScanner::scan(Path::new("/nonexistent/path"))
            .await
            .unwrap();
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn scan_subagents() {
        let dir = TempDir::new().unwrap();
        let session_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let subagents_dir = dir
            .path()
            .join("projects")
            .join("-test")
            .join(session_id)
            .join("subagents");
        fs::create_dir_all(&subagents_dir).unwrap();

        fs::write(subagents_dir.join("agent-abc1234.jsonl"), "{}").unwrap();
        fs::write(subagents_dir.join("agent-def5678.jsonl"), "{}").unwrap();

        let agents =
            SessionScanner::scan_subagents(dir.path(), "-test", session_id).await;
        assert_eq!(agents.len(), 2);
        assert!(agents.iter().any(|a| a.agent_id == "abc1234"));
        assert!(agents.iter().any(|a| a.agent_id == "def5678"));
    }

    #[test]
    fn watch_new_sessions_channel() {
        let scanner = SessionScanner::new(16);
        let mut rx = scanner.watch_new_sessions();

        let info = SessionInfo {
            id: "test-session".to_string(),
            jsonl_path: PathBuf::from("/tmp/test.jsonl"),
            project_path: Some(PathBuf::from("/test")),
            last_modified: SystemTime::now(),
            size_bytes: 100,
        };

        scanner.notify_new_session(info.clone());

        let received = rx.try_recv().unwrap();
        assert_eq!(received.id, "test-session");
    }
}
