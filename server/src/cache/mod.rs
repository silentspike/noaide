//! Message Cache Layer — ECS-backed in-memory cache for parsed JSONL messages.
//!
//! Instead of re-parsing the entire JSONL file on every API request,
//! we parse incrementally (from stored byte offset) and cache the resulting
//! MessageComponents in the ECS. API handlers read from ECS for <5ms responses.
//!
//! LRU eviction ensures at most MAX_WARM_SESSIONS sessions are cached
//! simultaneously, keeping RSS under the 200MB budget.

use std::collections::VecDeque;
use std::path::Path;

use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::discovery::scanner::CliType;
use crate::ecs::components::{CacheMetaComponent, MessageComponent};
use crate::ecs::world::EcsWorld;
use crate::parser;

/// Maximum number of sessions with warm (fully-parsed) message caches.
/// When exceeded, the least-recently-accessed session's messages are evicted.
/// 20 sessions × ~2000 messages × ~2KB per message ≈ ~80MB worst case.
const MAX_WARM_SESSIONS: usize = 20;

/// Maximum total messages across all warm caches.
/// If this is exceeded even with <MAX_WARM_SESSIONS, evict oldest until under budget.
const MAX_TOTAL_CACHED_MESSAGES: usize = 200_000;

/// Maximum JSONL file size (bytes) that will be fully cached in ECS.
/// Files larger than this are served directly via parser with pagination.
/// 10MB ≈ 6700 messages — plenty for typical sessions.
/// A 437MB file has ~290k messages that would consume >500MB RAM.
const MAX_CACHEABLE_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// LRU tracker for warm session caches.
/// Front = least recently used, Back = most recently used.
/// This is separate from ECS to avoid polluting the entity model.
static LRU: std::sync::LazyLock<tokio::sync::Mutex<VecDeque<Uuid>>> =
    std::sync::LazyLock::new(|| {
        tokio::sync::Mutex::new(VecDeque::with_capacity(MAX_WARM_SESSIONS + 1))
    });

/// Touch a session in the LRU (move to back = most recently used).
async fn lru_touch(session_id: Uuid) {
    let mut lru = LRU.lock().await;
    // Remove from current position (if present)
    if let Some(pos) = lru.iter().position(|&id| id == session_id) {
        lru.remove(pos);
    }
    // Push to back (most recently used)
    lru.push_back(session_id);
}

/// Evict least-recently-used sessions until we're under budget.
/// Returns the number of sessions evicted.
async fn lru_evict(ecs: &mut EcsWorld) -> usize {
    let mut lru = LRU.lock().await;
    let mut evicted = 0;

    // Evict by count: if more than MAX_WARM_SESSIONS
    while lru.len() > MAX_WARM_SESSIONS {
        if let Some(victim) = lru.pop_front() {
            let msg_count = ecs.message_count_for_session(victim);
            ecs.invalidate_cache(victim);
            evicted += 1;
            debug!(
                session = %victim,
                messages_freed = msg_count,
                "LRU evicted (count limit)"
            );
        }
    }

    // Evict by total message count budget
    while ecs.message_count() > MAX_TOTAL_CACHED_MESSAGES && !lru.is_empty() {
        if let Some(victim) = lru.pop_front() {
            let msg_count = ecs.message_count_for_session(victim);
            ecs.invalidate_cache(victim);
            evicted += 1;
            debug!(
                session = %victim,
                messages_freed = msg_count,
                total_remaining = ecs.message_count(),
                "LRU evicted (message budget)"
            );
        }
    }

    if evicted > 0 {
        info!(
            evicted,
            warm_sessions = lru.len(),
            total_messages = ecs.message_count(),
            "LRU eviction completed"
        );
    }

    evicted
}

/// Ensure a session's cache is warm. If not, do a full parse.
/// Applies LRU eviction to stay within memory budget.
/// Returns the number of cached messages.
pub async fn ensure_warm(
    ecs: &mut EcsWorld,
    session_id: Uuid,
    jsonl_path: &Path,
    cli_type: CliType,
) -> anyhow::Result<usize> {
    if ecs.is_cache_warm(session_id) {
        // Already warm — just touch LRU and return
        lru_touch(session_id).await;
        return Ok(ecs.message_count_for_session(session_id));
    }

    // Skip caching for very large files — they'd blow the memory budget.
    // The caller falls through to direct-parse with pagination.
    let file_size = tokio::fs::metadata(jsonl_path).await?.len();
    if file_size > MAX_CACHEABLE_FILE_SIZE {
        warn!(
            session_id = %session_id,
            file_size_mb = file_size / (1024 * 1024),
            "JSONL too large for cache ({} MB > {} MB limit), serving directly",
            file_size / (1024 * 1024),
            MAX_CACHEABLE_FILE_SIZE / (1024 * 1024),
        );
        return Err(anyhow::anyhow!("file too large for cache"));
    }

    // Evict before loading to stay under budget
    lru_evict(ecs).await;

    // Full parse from offset 0
    let count = refresh(ecs, session_id, jsonl_path, cli_type).await?;

    // Register in LRU
    lru_touch(session_id).await;

    debug!(session_id = %session_id, count, "cache warmed");
    Ok(count)
}

/// Incremental refresh: parse new data since last cached offset.
/// Returns total message count after refresh.
pub async fn refresh(
    ecs: &mut EcsWorld,
    session_id: Uuid,
    jsonl_path: &Path,
    cli_type: CliType,
) -> anyhow::Result<usize> {
    let meta = ecs.query_cache_meta(session_id);
    let from_offset = meta.as_ref().map_or(0, |m| m.file_offset);
    let old_file_size = meta.as_ref().map_or(0, |m| m.file_size);

    // Get current file size for truncation detection
    let file_meta = tokio::fs::metadata(jsonl_path).await?;
    let current_file_size = file_meta.len();

    // Truncation detection: if file shrunk, invalidate and re-parse from 0
    let effective_offset = if current_file_size < old_file_size && old_file_size > 0 {
        warn!(
            session_id = %session_id,
            old_size = old_file_size,
            new_size = current_file_size,
            "JSONL truncated, invalidating cache"
        );
        ecs.invalidate_cache(session_id);
        0
    } else {
        from_offset
    };

    // Parse new data
    let (new_messages, new_components, new_offset) = match cli_type {
        CliType::Claude => {
            let (msgs, offset) = parser::parse_incremental(jsonl_path, effective_offset).await?;
            let components: Vec<MessageComponent> = msgs
                .iter()
                .filter_map(|m| parser::message_to_component(m, session_id))
                .collect();
            (msgs.len(), components, offset)
        }
        CliType::Codex => {
            // Codex files are single JSON — always full parse
            if effective_offset > 0 && current_file_size == old_file_size {
                // No change — skip
                return Ok(ecs.message_count_for_session(session_id));
            }
            ecs.invalidate_cache(session_id);
            let msgs = parser::parse_codex_file(jsonl_path).await?;
            let components: Vec<MessageComponent> = msgs
                .iter()
                .filter_map(|m| parser::message_to_component(m, session_id))
                .collect();
            (msgs.len(), components, current_file_size)
        }
        CliType::Gemini => {
            // Gemini files are single JSON — always full parse
            if effective_offset > 0 && current_file_size == old_file_size {
                return Ok(ecs.message_count_for_session(session_id));
            }
            ecs.invalidate_cache(session_id);
            let msgs = parser::parse_gemini_file(jsonl_path).await?;
            let components: Vec<MessageComponent> = msgs
                .iter()
                .filter_map(|m| parser::message_to_component(m, session_id))
                .collect();
            (msgs.len(), components, current_file_size)
        }
    };

    // Spawn new message entities
    for component in new_components {
        ecs.spawn_message(component);
    }

    let total_count = ecs.message_count_for_session(session_id);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    ecs.upsert_cache_meta(CacheMetaComponent {
        session_id,
        file_offset: new_offset,
        file_size: current_file_size,
        last_refreshed: now,
        message_count: total_count,
        is_warm: true,
    });

    debug!(
        session_id = %session_id,
        new_messages,
        total_count,
        offset = new_offset,
        "cache refreshed"
    );

    Ok(total_count)
}

/// Convert a MessageComponent to the JSON shape the API returns.
pub fn component_to_api_json(m: &MessageComponent) -> serde_json::Value {
    let role = match m.role {
        crate::ecs::components::MessageRole::User => "user",
        crate::ecs::components::MessageRole::Assistant => "assistant",
        crate::ecs::components::MessageRole::System => "system",
        crate::ecs::components::MessageRole::Meta => "meta",
    };

    let message_type = match m.message_type {
        crate::ecs::components::MessageType::Text => "text",
        crate::ecs::components::MessageType::ToolUse => "tool_use",
        crate::ecs::components::MessageType::ToolResult => "tool_result",
        crate::ecs::components::MessageType::Thinking => "thinking",
        crate::ecs::components::MessageType::SystemReminder => "system-reminder",
        crate::ecs::components::MessageType::Error => "error",
        crate::ecs::components::MessageType::Progress => "progress",
        crate::ecs::components::MessageType::Summary => "summary",
        crate::ecs::components::MessageType::FileSnapshot => "file-history-snapshot",
        crate::ecs::components::MessageType::CompactBoundary => "compact_boundary",
    };

    let mut obj = serde_json::json!({
        "uuid": m.id.to_string(),
        "sessionId": m.session_id.to_string(),
        "role": role,
        "content": m.content,
        "timestamp": m.timestamp,
        "tokens": m.tokens,
        "hidden": m.hidden,
        "messageType": message_type,
        "model": m.model,
        "stopReason": m.stop_reason,
        "inputTokens": m.input_tokens,
        "outputTokens": m.output_tokens,
        "cacheCreationInputTokens": m.cache_creation_input_tokens,
        "cacheReadInputTokens": m.cache_read_input_tokens,
    });

    // Include parsed content blocks if available
    if let Some(ref blocks_json) = m.content_blocks_json {
        if let Ok(blocks) = serde_json::from_str::<serde_json::Value>(blocks_json) {
            obj["contentBlocks"] = blocks;
        }
    }

    obj
}
