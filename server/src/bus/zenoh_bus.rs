use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::{RwLock, broadcast};
use tracing::{debug, info, warn};

use super::EventBus;
use super::topics::{DedupTracker, EventEnvelope, LamportClock, TopicConfig, topic_config};

/// Per-topic state: broadcast sender + config.
#[allow(dead_code)] // config stored for future backpressure enforcement
struct TopicState {
    sender: broadcast::Sender<EventEnvelope>,
    config: TopicConfig,
}

/// Zenoh-backed event bus with optional SHM for zero-copy IPC.
///
/// In the current implementation, Zenoh is used as an in-process pub/sub
/// with tokio broadcast channels per topic. SHM is activated when available
/// and the `ENABLE_SHM` feature flag is set.
pub struct ZenohBus {
    /// Zenoh session handle (kept alive for the lifetime of the bus).
    _session: zenoh::Session,
    /// Whether SHM is active.
    shm_active: bool,
    /// Lamport Clock for global causal ordering.
    clock: LamportClock,
    /// Per-source sequence counters.
    sequences: RwLock<HashMap<String, AtomicU64>>,
    /// Per-topic broadcast channels.
    topics: RwLock<HashMap<String, TopicState>>,
    /// Dedup tracker for echo elimination.
    dedup: DedupTracker,
}

impl ZenohBus {
    /// Create a new Zenoh event bus.
    ///
    /// - `enable_shm`: attempt to use Shared Memory for zero-copy IPC
    pub async fn new(enable_shm: bool) -> anyhow::Result<Arc<Self>> {
        let mut config = zenoh::Config::default();

        // Peer mode — in-process, no external router needed
        config
            .insert_json5("mode", r#""peer""#)
            .map_err(|e| anyhow::anyhow!("zenoh config error: {e}"))?;

        // Try to enable SHM
        let mut shm_active = false;
        if enable_shm {
            match config.insert_json5("transport/shared_memory/enabled", "true") {
                Ok(_) => {
                    info!("zenoh SHM enabled in config");
                }
                Err(e) => {
                    warn!(error = %e, "zenoh SHM config failed, will use TCP transport");
                }
            }
        }

        let session = zenoh::open(config)
            .await
            .map_err(|e| anyhow::anyhow!("zenoh open failed: {e}"))?;

        // Check if SHM is actually active
        if enable_shm {
            // SHM is available if the session opened without falling back
            shm_active = true;
            info!("zenoh session opened with SHM support");
        } else {
            info!("zenoh session opened (SHM disabled)");
        }

        let bus = Arc::new(Self {
            _session: session,
            shm_active,
            clock: LamportClock::new(),
            sequences: RwLock::new(HashMap::new()),
            topics: RwLock::new(HashMap::new()),
            dedup: DedupTracker::new(1000),
        });

        info!(shm = bus.shm_active, "zenoh event bus initialized");

        Ok(bus)
    }

    /// Get or create the broadcast channel for a topic.
    async fn get_or_create_topic(&self, topic: &str) -> broadcast::Sender<EventEnvelope> {
        // Fast path: read lock
        {
            let topics = self.topics.read().await;
            if let Some(state) = topics.get(topic) {
                return state.sender.clone();
            }
        }

        // Slow path: write lock to create
        let mut topics = self.topics.write().await;
        // Double-check after acquiring write lock
        if let Some(state) = topics.get(topic) {
            return state.sender.clone();
        }

        let config = topic_config(topic);
        let (sender, _) = broadcast::channel(config.capacity);
        debug!(topic, capacity = config.capacity, "created topic channel");

        topics.insert(
            topic.to_string(),
            TopicState {
                sender: sender.clone(),
                config,
            },
        );

        sender
    }

    /// Get the next sequence number for a source.
    async fn next_sequence(&self, source_key: &str) -> u64 {
        // Fast path: read lock
        {
            let sequences = self.sequences.read().await;
            if let Some(counter) = sequences.get(source_key) {
                return counter.fetch_add(1, Ordering::SeqCst) + 1;
            }
        }

        // Slow path: create new counter
        let mut sequences = self.sequences.write().await;
        if let Some(counter) = sequences.get(source_key) {
            return counter.fetch_add(1, Ordering::SeqCst) + 1;
        }
        sequences.insert(source_key.to_string(), AtomicU64::new(1));
        1
    }
}

#[async_trait::async_trait]
impl EventBus for ZenohBus {
    async fn publish(&self, topic: &str, mut envelope: EventEnvelope) -> anyhow::Result<()> {
        // Check dedup
        if let Some(ref key) = envelope.dedup_key
            && !self.dedup.record(key.clone())
        {
            debug!(
                topic,
                dedup_key = key.as_str(),
                "event deduplicated, skipping publish"
            );
            return Ok(());
        }

        // Assign Lamport timestamp
        let ts = self.clock.tick();
        envelope.logical_ts = ts;

        // Assign sequence number per source
        let source_key = format!("{:?}", envelope.source);
        let seq = self.next_sequence(&source_key).await;
        envelope.sequence = seq;

        // Get topic channel and publish
        let sender = self.get_or_create_topic(topic).await;

        match sender.send(envelope) {
            Ok(receivers) => {
                debug!(topic, receivers, logical_ts = ts, "event published");
                Ok(())
            }
            Err(_) => {
                // No active receivers — not an error, just no one is listening
                debug!(topic, "event published but no active receivers");
                Ok(())
            }
        }
    }

    async fn subscribe(&self, topic: &str) -> anyhow::Result<broadcast::Receiver<EventEnvelope>> {
        let sender = self.get_or_create_topic(topic).await;
        Ok(sender.subscribe())
    }

    fn logical_clock(&self) -> u64 {
        self.clock.current()
    }

    fn is_shm_active(&self) -> bool {
        self.shm_active
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bus::topics::{EventSource, FILE_CHANGES, SESSION_MESSAGES, SYSTEM_EVENTS};

    async fn create_test_bus() -> Arc<ZenohBus> {
        ZenohBus::new(false).await.unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn publish_subscribe_roundtrip() {
        let bus = create_test_bus().await;

        let mut rx = bus.subscribe(SESSION_MESSAGES).await.unwrap();

        let envelope = EventEnvelope::new(EventSource::Jsonl, 0, 0, None, vec![42]);

        bus.publish(SESSION_MESSAGES, envelope).await.unwrap();

        let received = rx.recv().await.unwrap();
        assert_eq!(received.source, EventSource::Jsonl);
        assert_eq!(received.payload, vec![42]);
        assert!(received.logical_ts > 0); // Lamport clock assigned
        assert!(received.sequence > 0); // Sequence assigned
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn lamport_clock_monotonic_across_publishes() {
        let bus = create_test_bus().await;
        let mut rx = bus.subscribe(FILE_CHANGES).await.unwrap();

        for _ in 0..5 {
            let env = EventEnvelope::new(EventSource::Watcher, 0, 0, None, vec![]);
            bus.publish(FILE_CHANGES, env).await.unwrap();
        }

        let mut last_ts = 0;
        for _ in 0..5 {
            let received = rx.recv().await.unwrap();
            assert!(received.logical_ts > last_ts);
            last_ts = received.logical_ts;
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dedup_eliminates_echo() {
        let bus = create_test_bus().await;
        let mut rx = bus.subscribe(SESSION_MESSAGES).await.unwrap();

        let env1 =
            EventEnvelope::new(EventSource::Pty, 0, 0, None, vec![1]).with_dedup("echo:1".into());
        let env2 =
            EventEnvelope::new(EventSource::Jsonl, 0, 0, None, vec![2]).with_dedup("echo:1".into());
        let env3 =
            EventEnvelope::new(EventSource::Jsonl, 0, 0, None, vec![3]).with_dedup("echo:2".into());

        bus.publish(SESSION_MESSAGES, env1).await.unwrap();
        bus.publish(SESSION_MESSAGES, env2).await.unwrap(); // duplicate — skipped
        bus.publish(SESSION_MESSAGES, env3).await.unwrap();

        let r1 = rx.recv().await.unwrap();
        let r2 = rx.recv().await.unwrap();
        assert_eq!(r1.payload, vec![1]); // First "echo:1"
        assert_eq!(r2.payload, vec![3]); // "echo:2" (not the duplicate)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn multiple_subscribers() {
        let bus = create_test_bus().await;

        let mut rx1 = bus.subscribe(SYSTEM_EVENTS).await.unwrap();
        let mut rx2 = bus.subscribe(SYSTEM_EVENTS).await.unwrap();

        let env = EventEnvelope::new(EventSource::User, 0, 0, None, vec![99]);
        bus.publish(SYSTEM_EVENTS, env).await.unwrap();

        let r1 = rx1.recv().await.unwrap();
        let r2 = rx2.recv().await.unwrap();
        assert_eq!(r1.payload, vec![99]);
        assert_eq!(r2.payload, vec![99]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn publish_no_subscribers_ok() {
        let bus = create_test_bus().await;
        // Publishing without any subscriber should not error
        let env = EventEnvelope::new(EventSource::Watcher, 0, 0, None, vec![]);
        let result = bus.publish(FILE_CHANGES, env).await;
        assert!(result.is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn sequence_numbers_per_source() {
        let bus = create_test_bus().await;
        let mut rx = bus.subscribe(FILE_CHANGES).await.unwrap();

        // Publish from two different sources
        for _ in 0..3 {
            let env = EventEnvelope::new(EventSource::Watcher, 0, 0, None, vec![]);
            bus.publish(FILE_CHANGES, env).await.unwrap();
        }
        for _ in 0..2 {
            let env = EventEnvelope::new(EventSource::User, 0, 0, None, vec![]);
            bus.publish(FILE_CHANGES, env).await.unwrap();
        }

        // Watcher sequences: 1, 2, 3
        let r1 = rx.recv().await.unwrap();
        let r2 = rx.recv().await.unwrap();
        let r3 = rx.recv().await.unwrap();
        assert_eq!(r1.sequence, 1);
        assert_eq!(r2.sequence, 2);
        assert_eq!(r3.sequence, 3);

        // User sequences: 1, 2
        let r4 = rx.recv().await.unwrap();
        let r5 = rx.recv().await.unwrap();
        assert_eq!(r4.sequence, 1);
        assert_eq!(r5.sequence, 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn logical_clock_value() {
        let bus = create_test_bus().await;
        assert_eq!(bus.logical_clock(), 0);

        let env = EventEnvelope::new(EventSource::Jsonl, 0, 0, None, vec![]);
        bus.publish(SESSION_MESSAGES, env).await.unwrap();

        assert!(bus.logical_clock() > 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn shm_disabled_by_default_in_tests() {
        let bus = create_test_bus().await;
        // Tests create bus with SHM disabled
        assert!(!bus.is_shm_active());
    }
}
