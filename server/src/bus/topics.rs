use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Topic Constants ──────────────────────────────────────────────────────────

/// JSONL messages from Claude Code sessions.
pub const SESSION_MESSAGES: &str = "session/messages";

/// File system change events (create, modify, delete).
pub const FILE_CHANGES: &str = "files/changes";

/// Task list updates (kanban board state).
pub const TASK_UPDATES: &str = "tasks/updates";

/// Multi-agent team metrics.
pub const AGENT_METRICS: &str = "agents/metrics";

/// System lifecycle events (startup, shutdown, errors).
pub const SYSTEM_EVENTS: &str = "system/events";

/// API proxy request/response pairs.
pub const API_REQUESTS: &str = "api/requests";

// ── Backpressure Policies ────────────────────────────────────────────────────

/// Backpressure policy for a topic's bounded queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropPolicy {
    /// Drop oldest events when queue is full.
    DropOldest,
    /// Never drop — block publisher until space available.
    NeverDrop,
}

/// Per-topic backpressure configuration.
#[derive(Debug, Clone, Copy)]
pub struct TopicConfig {
    pub capacity: usize,
    pub drop_policy: DropPolicy,
}

/// Get the backpressure configuration for a topic.
pub fn topic_config(topic: &str) -> TopicConfig {
    match topic {
        FILE_CHANGES => TopicConfig {
            capacity: 500,
            drop_policy: DropPolicy::DropOldest,
        },
        SESSION_MESSAGES => TopicConfig {
            capacity: 10_000,
            drop_policy: DropPolicy::NeverDrop,
        },
        SYSTEM_EVENTS => TopicConfig {
            capacity: 100,
            drop_policy: DropPolicy::DropOldest,
        },
        TASK_UPDATES => TopicConfig {
            capacity: 500,
            drop_policy: DropPolicy::DropOldest,
        },
        AGENT_METRICS => TopicConfig {
            capacity: 200,
            drop_policy: DropPolicy::DropOldest,
        },
        API_REQUESTS => TopicConfig {
            capacity: 1_000,
            drop_policy: DropPolicy::DropOldest,
        },
        // Unknown topics get sensible defaults
        _ => TopicConfig {
            capacity: 256,
            drop_policy: DropPolicy::DropOldest,
        },
    }
}

// ── EventSource ──────────────────────────────────────────────────────────────

/// Origin of an event in the system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventSource {
    /// Parsed from a JSONL file.
    Jsonl,
    /// Read from PTY stdout.
    Pty,
    /// Captured from API proxy.
    Proxy,
    /// Detected by file watcher.
    Watcher,
    /// Initiated by the user (via UI).
    User,
}

// ── EventEnvelope ────────────────────────────────────────────────────────────

/// Wrapper around every event flowing through the bus.
///
/// Provides global ordering (Lamport Clock), deduplication,
/// and source attribution for all system events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEnvelope {
    /// Unique event identifier.
    pub event_id: Uuid,
    /// Where this event originated.
    pub source: EventSource,
    /// Monotonically increasing per source.
    pub sequence: u64,
    /// Lamport Clock value for global causal ordering.
    pub logical_ts: u64,
    /// Wall clock timestamp (Unix millis).
    pub wall_ts: i64,
    /// Session this event belongs to (if applicable).
    pub session_id: Option<Uuid>,
    /// Key for echo elimination (e.g., PTY input echoed back in JSONL).
    pub dedup_key: Option<String>,
    /// Serialized event payload (MessagePack).
    pub payload: Vec<u8>,
}

impl EventEnvelope {
    /// Create a new envelope with the given source and payload.
    ///
    /// The Lamport clock value and sequence must be provided by the caller
    /// (typically the EventBus implementation manages these).
    pub fn new(
        source: EventSource,
        sequence: u64,
        logical_ts: u64,
        session_id: Option<Uuid>,
        payload: Vec<u8>,
    ) -> Self {
        Self {
            event_id: Uuid::new_v4(),
            source,
            sequence,
            logical_ts,
            wall_ts: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
            session_id,
            dedup_key: None,
            payload,
        }
    }

    /// Set the dedup key for echo elimination.
    pub fn with_dedup(mut self, key: String) -> Self {
        self.dedup_key = Some(key);
        self
    }
}

// ── Lamport Clock ────────────────────────────────────────────────────────────

/// A Lamport logical clock for causal event ordering.
///
/// Rules:
/// - Increment on every local event (publish)
/// - On receive: local = max(local, received) + 1
pub struct LamportClock {
    value: AtomicU64,
}

impl LamportClock {
    pub fn new() -> Self {
        Self {
            value: AtomicU64::new(0),
        }
    }

    /// Increment and return the new value (for publish).
    pub fn tick(&self) -> u64 {
        self.value.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Update on receiving a remote event: max(local, remote) + 1.
    pub fn receive(&self, remote_ts: u64) -> u64 {
        loop {
            let current = self.value.load(Ordering::SeqCst);
            let new_val = std::cmp::max(current, remote_ts) + 1;
            if self
                .value
                .compare_exchange(current, new_val, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                return new_val;
            }
        }
    }

    /// Current clock value without incrementing.
    pub fn current(&self) -> u64 {
        self.value.load(Ordering::SeqCst)
    }
}

impl Default for LamportClock {
    fn default() -> Self {
        Self::new()
    }
}

// ── Dedup ────────────────────────────────────────────────────────────────────

/// Ring buffer for dedup key tracking.
///
/// Keeps the last N dedup keys to reject echo events.
pub struct DedupTracker {
    keys: std::sync::Mutex<Vec<String>>,
    capacity: usize,
}

impl DedupTracker {
    pub fn new(capacity: usize) -> Self {
        Self {
            keys: std::sync::Mutex::new(Vec::with_capacity(capacity)),
            capacity,
        }
    }

    /// Returns `true` if this key is a duplicate (already seen).
    pub fn is_duplicate(&self, key: &str) -> bool {
        let keys = self.keys.lock().unwrap();
        keys.contains(&key.to_string())
    }

    /// Record a dedup key. Returns `true` if it was new (not a dup).
    pub fn record(&self, key: String) -> bool {
        let mut keys = self.keys.lock().unwrap();
        if keys.contains(&key) {
            return false;
        }
        if keys.len() >= self.capacity {
            keys.remove(0); // Drop oldest
        }
        keys.push(key);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lamport_clock_tick_monotonic() {
        let clock = LamportClock::new();
        let t1 = clock.tick();
        let t2 = clock.tick();
        let t3 = clock.tick();
        assert_eq!(t1, 1);
        assert_eq!(t2, 2);
        assert_eq!(t3, 3);
    }

    #[test]
    fn lamport_clock_receive_updates() {
        let clock = LamportClock::new();
        clock.tick(); // local = 1
        clock.tick(); // local = 2

        // Receive remote event with ts=10 → local = max(2, 10) + 1 = 11
        let new_ts = clock.receive(10);
        assert_eq!(new_ts, 11);
        assert_eq!(clock.current(), 11);
    }

    #[test]
    fn lamport_clock_receive_lower_than_local() {
        let clock = LamportClock::new();
        for _ in 0..5 {
            clock.tick();
        }
        // local = 5, receive remote=3 → max(5,3)+1 = 6
        let new_ts = clock.receive(3);
        assert_eq!(new_ts, 6);
    }

    #[test]
    fn dedup_tracker_rejects_duplicates() {
        let tracker = DedupTracker::new(10);
        assert!(tracker.record("key1".into())); // new
        assert!(tracker.record("key2".into())); // new
        assert!(!tracker.record("key1".into())); // duplicate
        assert!(tracker.is_duplicate("key1"));
        assert!(!tracker.is_duplicate("key3"));
    }

    #[test]
    fn dedup_tracker_capacity_eviction() {
        let tracker = DedupTracker::new(3);
        tracker.record("a".into());
        tracker.record("b".into());
        tracker.record("c".into());
        // Full — adding "d" evicts "a"
        tracker.record("d".into());
        assert!(!tracker.is_duplicate("a")); // evicted
        assert!(tracker.is_duplicate("b"));
        assert!(tracker.is_duplicate("d"));
    }

    #[test]
    fn event_envelope_new() {
        let env = EventEnvelope::new(EventSource::Jsonl, 1, 5, None, vec![1, 2, 3]);
        assert_eq!(env.source, EventSource::Jsonl);
        assert_eq!(env.sequence, 1);
        assert_eq!(env.logical_ts, 5);
        assert!(env.wall_ts > 0);
        assert!(env.dedup_key.is_none());
        assert_eq!(env.payload, vec![1, 2, 3]);
    }

    #[test]
    fn event_envelope_with_dedup() {
        let env = EventEnvelope::new(EventSource::Pty, 1, 1, None, vec![])
            .with_dedup("pty:1:echo".into());
        assert_eq!(env.dedup_key, Some("pty:1:echo".into()));
    }

    #[test]
    fn topic_config_session_messages_never_drop() {
        let cfg = topic_config(SESSION_MESSAGES);
        assert_eq!(cfg.capacity, 10_000);
        assert_eq!(cfg.drop_policy, DropPolicy::NeverDrop);
    }

    #[test]
    fn topic_config_file_changes_drop_oldest() {
        let cfg = topic_config(FILE_CHANGES);
        assert_eq!(cfg.capacity, 500);
        assert_eq!(cfg.drop_policy, DropPolicy::DropOldest);
    }

    #[test]
    fn topic_config_unknown_defaults() {
        let cfg = topic_config("some/unknown/topic");
        assert_eq!(cfg.capacity, 256);
        assert_eq!(cfg.drop_policy, DropPolicy::DropOldest);
    }

    #[test]
    fn event_source_serialization() {
        let source = EventSource::Jsonl;
        let json = serde_json::to_string(&source).unwrap();
        let deserialized: EventSource = serde_json::from_str(&json).unwrap();
        assert_eq!(source, deserialized);
    }
}
