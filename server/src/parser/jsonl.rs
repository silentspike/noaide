use std::path::Path;

use tokio::io::{AsyncBufReadExt, AsyncSeekExt, BufReader};
use tracing::{debug, instrument, warn};

use super::types::{parse_raw_to_message, ClaudeMessage};

/// Parse a complete JSONL file, returning all messages.
///
/// Malformed lines are skipped with a WARN log. Unknown message types
/// are preserved as `ClaudeMessage` with `message_type` set to the
/// unknown type string.
#[instrument(skip_all, fields(path = %path.display()))]
pub async fn parse_file(path: &Path) -> anyhow::Result<Vec<ClaudeMessage>> {
    let (messages, _offset) = parse_incremental(path, 0).await?;
    Ok(messages)
}

/// Parse incrementally from a byte offset (for live tailing).
///
/// Returns the parsed messages and the new byte offset. The caller
/// stores the offset for the next call to only parse new lines.
///
/// If the file was truncated (offset > file size), parsing restarts
/// from the beginning.
#[instrument(skip_all, fields(path = %path.display(), from_offset))]
pub async fn parse_incremental(
    path: &Path,
    from_offset: u64,
) -> anyhow::Result<(Vec<ClaudeMessage>, u64)> {
    let file = tokio::fs::File::open(path).await?;
    let file_len = file.metadata().await?.len();

    // Handle file truncation
    let effective_offset = if from_offset > file_len {
        debug!(
            from_offset,
            file_len, "file was truncated, restarting from beginning"
        );
        0
    } else {
        from_offset
    };

    let mut reader = BufReader::with_capacity(64 * 1024, file);
    if effective_offset > 0 {
        reader.seek(std::io::SeekFrom::Start(effective_offset)).await?;
    }

    let mut messages = Vec::new();
    let mut current_offset = effective_offset;
    let mut line_buf = String::new();
    let mut lines_parsed = 0u64;
    let mut errors = 0u64;

    loop {
        line_buf.clear();
        let bytes_read = reader.read_line(&mut line_buf).await?;
        if bytes_read == 0 {
            break;
        }

        current_offset += bytes_read as u64;
        let trimmed = line_buf.trim();
        if trimmed.is_empty() {
            continue;
        }

        lines_parsed += 1;

        match parse_line(trimmed) {
            Ok(msg) => messages.push(msg),
            Err(e) => {
                errors += 1;
                warn!(
                    error = %e,
                    line = lines_parsed,
                    preview = &trimmed[..trimmed.len().min(100)],
                    "skipping malformed JSONL line"
                );
            }
        }
    }

    debug!(
        lines_parsed,
        messages = messages.len(),
        errors,
        new_offset = current_offset,
        "parse complete"
    );

    Ok((messages, current_offset))
}

/// Parse a single JSONL line into a ClaudeMessage.
///
/// Two-pass approach:
/// 1. Parse as `serde_json::Value`
/// 2. Dispatch by `type` field to typed deserialization
pub fn parse_line(line: &str) -> anyhow::Result<ClaudeMessage> {
    let value: serde_json::Value = serde_json::from_str(line)?;
    let msg = parse_raw_to_message(value)?;
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn parse_file_basic() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            r#"{{"type":"user","message":{{"role":"user","content":"hello"}},"uuid":"1","timestamp":"2026-02-21T10:00:00Z"}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"hi"}}],"stop_reason":"end_turn","usage":{{"input_tokens":10,"output_tokens":5}}}},"uuid":"2","timestamp":"2026-02-21T10:01:00Z"}}"#
        )
        .unwrap();

        let messages = parse_file(file.path()).await.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message_type, "user");
        assert_eq!(messages[1].message_type, "assistant");
    }

    #[tokio::test]
    async fn parse_incremental_offset() {
        let mut file = NamedTempFile::new().unwrap();
        let line1 = r#"{"type":"user","message":{"role":"user","content":"first"},"uuid":"1","timestamp":"2026-02-21T10:00:00Z"}"#;
        let line2 = r#"{"type":"user","message":{"role":"user","content":"second"},"uuid":"2","timestamp":"2026-02-21T10:01:00Z"}"#;
        writeln!(file, "{line1}").unwrap();
        writeln!(file, "{line2}").unwrap();

        // Parse first line
        let (msgs1, offset) = parse_incremental(file.path(), 0).await.unwrap();
        assert_eq!(msgs1.len(), 2);
        assert!(offset > 0);

        // Append a third line
        let line3 = r#"{"type":"user","message":{"role":"user","content":"third"},"uuid":"3","timestamp":"2026-02-21T10:02:00Z"}"#;
        writeln!(file, "{line3}").unwrap();

        // Parse from offset — should only get the new line
        let (msgs2, _new_offset) = parse_incremental(file.path(), offset).await.unwrap();
        assert_eq!(msgs2.len(), 1);
        assert!(matches!(
            &msgs2[0].content,
            super::super::types::MessageContent::Text(s) if s == "third"
        ));
    }

    #[tokio::test]
    async fn malformed_lines_skipped() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            r#"{{"type":"user","message":{{"role":"user","content":"ok"}},"uuid":"1"}}"#
        )
        .unwrap();
        writeln!(file, "not valid json {{{{").unwrap();
        writeln!(
            file,
            r#"{{"type":"user","message":{{"role":"user","content":"also ok"}},"uuid":"2"}}"#
        )
        .unwrap();

        let messages = parse_file(file.path()).await.unwrap();
        assert_eq!(messages.len(), 2); // malformed line skipped
    }

    #[tokio::test]
    async fn empty_file() {
        let file = NamedTempFile::new().unwrap();
        let messages = parse_file(file.path()).await.unwrap();
        assert!(messages.is_empty());
    }

    #[tokio::test]
    async fn file_truncation_resets_offset() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            r#"{{"type":"user","message":{{"role":"user","content":"data"}},"uuid":"1"}}"#
        )
        .unwrap();

        // Parse with an offset way beyond file size
        let (msgs, _) = parse_incremental(file.path(), 999999).await.unwrap();
        assert_eq!(msgs.len(), 1); // restarted from 0
    }

    #[test]
    fn parse_line_valid() {
        let line = r#"{"type":"user","message":{"role":"user","content":"test"},"uuid":"1"}"#;
        let msg = parse_line(line).unwrap();
        assert_eq!(msg.message_type, "user");
    }

    #[test]
    fn parse_line_invalid() {
        let result = parse_line("not json");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn parse_many_lines_streaming() {
        let mut file = NamedTempFile::new().unwrap();
        for i in 0..10000 {
            writeln!(
                file,
                r#"{{"type":"user","message":{{"role":"user","content":"msg {i}"}},"uuid":"msg-{i}","timestamp":"2026-02-21T10:00:00Z"}}"#
            )
            .unwrap();
        }

        let start = std::time::Instant::now();
        let messages = parse_file(file.path()).await.unwrap();
        let elapsed = start.elapsed();

        assert_eq!(messages.len(), 10000);
        // Performance target: >10k lines/sec → <1s for 10k lines
        assert!(
            elapsed.as_secs() < 5,
            "expected <5s for 10000 lines, took {elapsed:?}"
        );
        eprintln!("benchmark: 10000 lines in {elapsed:?}");
    }

    #[tokio::test]
    async fn parse_sidechain_messages() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            r#"{{"type":"user","isSidechain":true,"agentId":"abc1234","message":{{"role":"user","content":"agent msg"}},"uuid":"a1","sessionId":"s1"}}"#
        )
        .unwrap();

        let messages = parse_file(file.path()).await.unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].is_sidechain, Some(true));
        assert_eq!(messages[0].agent_id, Some("abc1234".to_string()));
    }
}
