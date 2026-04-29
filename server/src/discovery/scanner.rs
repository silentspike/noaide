use std::path::{Path, PathBuf};
use std::time::SystemTime;

use tokio::sync::broadcast;
use tracing::{debug, info, warn};

/// Which CLI tool created the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CliType {
    #[default]
    Claude,
    Codex,
    Gemini,
}

impl CliType {
    pub fn as_str(&self) -> &'static str {
        match self {
            CliType::Claude => "claude",
            CliType::Codex => "codex",
            CliType::Gemini => "gemini",
        }
    }
}

/// Metadata about a discovered JSONL session file.
#[derive(Debug, Clone)]
pub struct SessionInfo {
    /// Session UUID extracted from filename.
    pub id: String,
    /// Full path to the .jsonl/.json file.
    pub jsonl_path: PathBuf,
    /// Decoded project path (e.g., `/work/noaide`).
    pub project_path: Option<PathBuf>,
    /// Last modified time.
    pub last_modified: SystemTime,
    /// File size in bytes.
    pub size_bytes: u64,
    /// Which CLI tool created this session.
    pub cli_type: CliType,
    /// Estimated message count (cheap: line-count for JSONL, JSON parse for Gemini).
    pub message_count_hint: usize,
    /// Epoch seconds of the first message timestamp (session start).
    /// Derived from reading the head of the file (first 8KB).
    pub started_at: i64,
    /// Epoch seconds of the last message timestamp in the session file.
    /// Derived from reading the tail of the file (last 8KB), not from file mtime.
    pub last_activity_at: i64,
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

    /// Scan a CLI directory for all session files.
    ///
    /// Supports three CLI tools:
    /// - **Claude Code**: `{dir}/projects/{project-dir}/{session-uuid}.jsonl`
    /// - **Codex**: `{dir}/sessions/YYYY/MM/DD/rollout-{timestamp}-{uuid}.jsonl`
    /// - **Gemini**: `{dir}/tmp/{hash}/chats/session-{timestamp}-{uuid}.json`
    pub async fn scan(cli_dir: &Path) -> anyhow::Result<Vec<SessionInfo>> {
        let mut sessions = Vec::new();

        // Claude Code: {dir}/projects/...
        let projects_dir = cli_dir.join("projects");
        if projects_dir.exists() {
            match Self::scan_claude_projects(&projects_dir).await {
                Ok(s) => {
                    info!(count = s.len(), cli = "claude", "discovered sessions");
                    sessions.extend(s);
                }
                Err(e) => warn!(error = %e, "failed to scan Claude projects"),
            }
        }

        // Codex: {dir}/sessions/...
        let codex_sessions_dir = cli_dir.join("sessions");
        if codex_sessions_dir.exists() {
            match Self::scan_codex_sessions(&codex_sessions_dir).await {
                Ok(s) => {
                    info!(count = s.len(), cli = "codex", "discovered sessions");
                    sessions.extend(s);
                }
                Err(e) => warn!(error = %e, "failed to scan Codex sessions"),
            }
        }

        // Gemini: {dir}/tmp/*/chats/...
        let gemini_tmp_dir = cli_dir.join("tmp");
        if gemini_tmp_dir.exists() {
            match Self::scan_gemini_sessions(&gemini_tmp_dir).await {
                Ok(s) => {
                    info!(count = s.len(), cli = "gemini", "discovered sessions");
                    sessions.extend(s);
                }
                Err(e) => warn!(error = %e, "failed to scan Gemini sessions"),
            }
        }

        if sessions.is_empty() {
            info!(path = %cli_dir.display(), "no sessions found");
        }

        Ok(sessions)
    }

    /// Scan Claude Code projects directory.
    async fn scan_claude_projects(projects_dir: &Path) -> anyhow::Result<Vec<SessionInfo>> {
        let mut sessions = Vec::new();
        let mut project_entries = tokio::fs::read_dir(projects_dir).await?;

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

        Ok(sessions)
    }

    /// Scan Codex sessions directory (YYYY/MM/DD/rollout-*.jsonl).
    async fn scan_codex_sessions(sessions_dir: &Path) -> anyhow::Result<Vec<SessionInfo>> {
        let mut sessions = Vec::new();
        Self::scan_codex_recursive(sessions_dir, &mut sessions).await?;
        Ok(sessions)
    }

    async fn scan_codex_recursive(
        root: &Path,
        sessions: &mut Vec<SessionInfo>,
    ) -> anyhow::Result<()> {
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let mut entries = match tokio::fs::read_dir(&dir).await {
                Ok(e) => e,
                Err(_) => continue,
            };
            while let Some(entry) = entries.next_entry().await? {
                let ft = entry.file_type().await?;
                if ft.is_dir() {
                    stack.push(entry.path());
                } else if ft.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.ends_with(".jsonl") {
                        continue;
                    }

                    let session_id = extract_codex_uuid(&name)
                        .unwrap_or_else(|| name.trim_end_matches(".jsonl").to_string());

                    let metadata = match entry.metadata().await {
                        Ok(m) => m,
                        Err(_) => continue,
                    };

                    // Derive project path from Codex session_meta CWD field.
                    // Falls back to date label (YYYY/MM/DD) if extraction fails.
                    let codex_label = extract_codex_cwd(&entry.path()).await.or_else(|| {
                        entry.path().parent().map(|p| {
                            let components: Vec<_> = p
                                .components()
                                .rev()
                                .take(3)
                                .map(|c| c.as_os_str().to_string_lossy().to_string())
                                .collect();
                            if components.len() == 3 {
                                format!("{}/{}/{}", components[2], components[1], components[0])
                            } else {
                                "codex".to_string()
                            }
                        })
                    });

                    let line_count = estimate_line_count(&entry.path()).await;
                    let first_ts = extract_first_timestamp(&entry.path()).await;
                    let last_ts = extract_last_timestamp(&entry.path()).await;

                    sessions.push(SessionInfo {
                        id: session_id,
                        jsonl_path: entry.path(),
                        project_path: codex_label.map(PathBuf::from),
                        last_modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                        size_bytes: metadata.len(),
                        cli_type: CliType::Codex,
                        message_count_hint: line_count,
                        started_at: first_ts,
                        last_activity_at: last_ts,
                    });
                }
            }
        }
        Ok(())
    }

    /// Scan Gemini tmp directory for chat session files.
    async fn scan_gemini_sessions(tmp_dir: &Path) -> anyhow::Result<Vec<SessionInfo>> {
        let mut sessions = Vec::new();
        let mut hash_dirs = tokio::fs::read_dir(tmp_dir).await?;

        while let Some(hash_entry) = hash_dirs.next_entry().await? {
            if !hash_entry.file_type().await?.is_dir() {
                continue;
            }

            let chats_dir = hash_entry.path().join("chats");
            if !chats_dir.exists() {
                continue;
            }

            let mut chat_entries = tokio::fs::read_dir(&chats_dir).await?;
            while let Some(chat_entry) = chat_entries.next_entry().await? {
                let name = chat_entry.file_name().to_string_lossy().to_string();
                if !name.starts_with("session-") || !name.ends_with(".json") {
                    continue;
                }

                // Extract UUID from filename: session-YYYY-MM-DDThh-mm-UUID.json
                let session_id = extract_gemini_uuid(&name)
                    .unwrap_or_else(|| name.trim_end_matches(".json").to_string());

                let metadata = match chat_entry.metadata().await {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                // Derive project label from Gemini path:
                // ~/.gemini/tmp/{project-name-or-hash}/chats/session-*.json
                let gemini_label = hash_entry.file_name().to_string_lossy().to_string();
                // If it's a 64-char hex hash, truncate for display
                let gemini_project = if gemini_label.len() == 64
                    && gemini_label.chars().all(|c| c.is_ascii_hexdigit())
                {
                    format!("gemini/{}", &gemini_label[..8])
                } else {
                    gemini_label
                };

                let msg_count = estimate_gemini_message_count(&chat_entry.path()).await;
                let first_ts = extract_first_timestamp(&chat_entry.path()).await;
                let last_ts = extract_last_timestamp(&chat_entry.path()).await;

                sessions.push(SessionInfo {
                    id: session_id,
                    jsonl_path: chat_entry.path(), // .json not .jsonl, but same field
                    project_path: Some(PathBuf::from(&gemini_project)),
                    last_modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    size_bytes: metadata.len(),
                    cli_type: CliType::Gemini,
                    message_count_hint: msg_count,
                    started_at: first_ts,
                    last_activity_at: last_ts,
                });
            }
        }

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

            // Estimate message count by counting newlines (cheap)
            let line_count = estimate_line_count(&entry.path()).await;
            let first_ts = extract_first_timestamp(&entry.path()).await;
            let last_ts = extract_last_timestamp(&entry.path()).await;

            sessions.push(SessionInfo {
                id: session_id,
                jsonl_path: entry.path(),
                project_path: Some(PathBuf::from(project_path)),
                last_modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                size_bytes: metadata.len(),
                cli_type: CliType::Claude,
                message_count_hint: line_count,
                started_at: first_ts,
                last_activity_at: last_ts,
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

/// Estimate message count from file size (no I/O beyond stat).
///
/// Average JSONL line is ~1500 bytes. Using file size avoids reading
/// the entire file into memory — critical for 200+ MB session files
/// that would cause glibc malloc heap fragmentation and RSS spikes.
async fn estimate_line_count(path: &Path) -> usize {
    match tokio::fs::metadata(path).await {
        Ok(m) => (m.len() / 1500).max(1) as usize,
        Err(_) => 0,
    }
}

/// Extract the timestamp of the first message from a session file.
///
/// Reads the first 8KB of the file and finds the first `"timestamp":"..."` pattern.
/// Returns 0 if extraction fails.
pub async fn extract_first_timestamp(path: &Path) -> i64 {
    use tokio::io::AsyncReadExt;
    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return 0,
    };

    let mut buf = vec![0u8; 8192];
    let bytes_read = match file.read(&mut buf).await {
        Ok(n) => n,
        Err(_) => return 0,
    };
    if bytes_read == 0 {
        return 0;
    }

    let text = String::from_utf8_lossy(&buf[..bytes_read]);
    // Try both compact ("timestamp":"...") and pretty-printed ("timestamp": "...") formats
    for needle in &[
        "\"timestamp\":\"",
        "\"timestamp\": \"",
        "\"startTime\":\"",
        "\"startTime\": \"",
    ] {
        if let Some(pos) = text.find(needle) {
            let abs_pos = pos + needle.len();
            if let Some(end) = text[abs_pos..].find('"') {
                let ts_str = &text[abs_pos..abs_pos + end];
                if let Some(epoch) = parse_iso_to_epoch_secs(ts_str) {
                    return epoch;
                }
            }
        }
    }
    0
}

/// Extract the timestamp of the last message from a session file.
///
/// Reads only the last 8KB of the file (cheap even for 200MB+ files),
/// finds the last `"timestamp":"..."` pattern, and parses it to epoch seconds.
/// Returns 0 if extraction fails.
pub async fn extract_last_timestamp(path: &Path) -> i64 {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return 0,
    };

    let file_size = match file.metadata().await {
        Ok(m) => m.len(),
        Err(_) => return 0,
    };

    let tail_size = 8192u64.min(file_size);
    if tail_size == 0 {
        return 0;
    }

    // Seek to tail
    let seek_pos = file_size.saturating_sub(tail_size);
    if file.seek(std::io::SeekFrom::Start(seek_pos)).await.is_err() {
        return 0;
    }

    let mut buf = vec![0u8; tail_size as usize];
    let bytes_read = match file.read(&mut buf).await {
        Ok(n) => n,
        Err(_) => return 0,
    };

    let text = String::from_utf8_lossy(&buf[..bytes_read]);

    // Find the LAST occurrence of timestamp patterns in the tail.
    // Supports both compact and pretty-printed JSON (Gemini uses spaces after colon).
    let mut last_ts: i64 = 0;
    for needle in &[
        "\"timestamp\":\"",
        "\"timestamp\": \"",
        "\"lastUpdated\":\"",
        "\"lastUpdated\": \"",
    ] {
        let mut search_from = 0;
        while let Some(pos) = text[search_from..].find(needle) {
            let abs_pos = search_from + pos + needle.len();
            if let Some(end) = text[abs_pos..].find('"') {
                let ts_str = &text[abs_pos..abs_pos + end];
                if let Some(epoch) = parse_iso_to_epoch_secs(ts_str)
                    && epoch > last_ts
                {
                    last_ts = epoch;
                }
            }
            search_from = abs_pos;
        }
    }

    last_ts
}

/// Parse a UTC ISO 8601 timestamp to epoch seconds.
///
/// Handles formats like:
/// - `2026-02-21T10:00:00.000Z`
/// - `2026-02-21T10:00:00Z`
/// - `2026-02-21T10:00:00`
pub fn parse_iso_to_epoch_secs(s: &str) -> Option<i64> {
    if s.len() < 19 {
        return None;
    }

    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let min: i64 = s.get(14..16)?.parse().ok()?;
    let sec: i64 = s.get(17..19)?.parse().ok()?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let days_in_month: [i64; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    let mut total_days: i64 = 0;

    // Years since 1970
    for y in 1970..year {
        total_days += if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
            366
        } else {
            365
        };
    }

    // Months
    let is_leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    for (m, &d) in days_in_month.iter().enumerate().take((month - 1) as usize) {
        total_days += d;
        if m == 1 && is_leap {
            total_days += 1;
        }
    }

    // Days
    total_days += day - 1;

    Some(total_days * 86400 + hour * 3600 + min * 60 + sec)
}

/// Estimate message count for a Gemini JSON file from file size.
///
/// Gemini JSON files contain a `messages` array. Average message is ~2000 bytes.
/// Reading and parsing the entire file every 30s would spike RSS for large sessions.
async fn estimate_gemini_message_count(path: &Path) -> usize {
    match tokio::fs::metadata(path).await {
        Ok(m) => (m.len() / 2000).max(1) as usize,
        Err(_) => 0,
    }
}

/// Extract CWD from Codex JSONL session_meta (first line).
///
/// Codex JSONL files start with a `session_meta` event containing `"cwd":"/path/to/project"`.
/// Reads only the first 4KB — cheap even for large files.
async fn extract_codex_cwd(path: &Path) -> Option<String> {
    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::open(path).await.ok()?;
    let mut buf = vec![0u8; 4096];
    let n = file.read(&mut buf).await.ok()?;
    if n == 0 {
        return None;
    }
    let text = std::str::from_utf8(&buf[..n]).ok()?;
    // Quick check: must be session_meta with cwd
    if !text.contains("\"session_meta\"") {
        return None;
    }
    // Extract "cwd":"..." value
    let needle = "\"cwd\":\"";
    let pos = text.find(needle)?;
    let start = pos + needle.len();
    let end = text[start..].find('"')?;
    let cwd = &text[start..start + end];
    if cwd.is_empty() {
        return None;
    }
    Some(cwd.to_string())
}

/// Extract UUID from Codex filename: `rollout-2025-10-26T12-54-26-UUID.jsonl`
pub fn extract_codex_uuid(filename: &str) -> Option<String> {
    // The UUID is the last segment before .jsonl
    let name = filename.trim_end_matches(".jsonl");
    // Format: rollout-YYYY-MM-DDThh-mm-ss-UUID
    // UUID has format: 8-4-4-4-12 hex chars
    // Find it by searching from the end for a UUID pattern
    let parts: Vec<&str> = name.rsplitn(6, '-').collect();
    if parts.len() >= 5 {
        // Reassemble: parts are reversed, so [0]=last12, [1]=last4, [2]=last4, [3]=last4, [4]=last8+prefix
        let candidate = format!(
            "{}-{}-{}-{}-{}",
            parts[4], parts[3], parts[2], parts[1], parts[0]
        );
        if uuid::Uuid::parse_str(&candidate).is_ok() {
            return Some(candidate);
        }
    }
    None
}

/// Extract UUID from Gemini filename: `session-2025-11-19T06-14-UUID.json`
pub fn extract_gemini_uuid(filename: &str) -> Option<String> {
    // The last segment (after last `-`) is a short hex ID
    let name = filename.trim_end_matches(".json");
    let last_dash = name.rfind('-')?;
    let id = &name[last_dash + 1..];
    // Gemini uses 8-char hex IDs, not full UUIDs — pad to valid UUID
    if id.len() == 8 && id.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(format!("{id}-0000-0000-0000-000000000000"))
    } else {
        Some(id.to_string())
    }
}

/// Decode a Claude Code project directory name back to a filesystem path.
///
/// Claude Code encodes paths by replacing `/` with `-` and prepending `-`.
///
/// Examples:
/// - `-work-noaide` → `/work/noaide`
/// - `-home-user` → `/home/user`
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
        assert_eq!(decode_project_dir("-home-user"), "/home/user");
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
        fs::write(projects_dir.join("sessions-index.jsonl"), "not a session").unwrap();

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

        let agents = SessionScanner::scan_subagents(dir.path(), "-test", session_id).await;
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
            cli_type: CliType::Claude,
            message_count_hint: 0,
            started_at: 0,
            last_activity_at: 0,
        };

        scanner.notify_new_session(info.clone());

        let received = rx.try_recv().unwrap();
        assert_eq!(received.id, "test-session");
    }
}
