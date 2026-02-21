pub mod topics;
pub mod zenoh_bus;

pub use topics::{
    AGENT_METRICS, API_REQUESTS, DedupTracker, DropPolicy, EventEnvelope, EventSource,
    FILE_CHANGES, LamportClock, SESSION_MESSAGES, SYSTEM_EVENTS, TASK_UPDATES, TopicConfig,
};
pub use zenoh_bus::ZenohBus;

use std::sync::Arc;

use tokio::sync::broadcast;

/// Trait for the system event bus.
///
/// All internal events flow through this bus with topic-based routing.
/// Two implementations:
/// - `ZenohBus`: Zenoh + SHM for production (~1us latency)
/// - Future: in-memory bus for testing
#[async_trait::async_trait]
pub trait EventBus: Send + Sync {
    /// Publish an event to a topic.
    ///
    /// The bus assigns Lamport Clock timestamp and sequence number.
    /// Dedup keys are checked before publishing.
    async fn publish(&self, topic: &str, envelope: EventEnvelope) -> anyhow::Result<()>;

    /// Subscribe to a topic, returns a broadcast receiver.
    ///
    /// Multiple subscribers can listen to the same topic.
    async fn subscribe(&self, topic: &str) -> anyhow::Result<broadcast::Receiver<EventEnvelope>>;

    /// Get the current Lamport Clock value.
    fn logical_clock(&self) -> u64;

    /// Check if Shared Memory transport is active.
    fn is_shm_active(&self) -> bool;
}

/// Create the default event bus (Zenoh + optional SHM).
///
/// - `enable_shm`: try to use Shared Memory for zero-copy IPC
///
/// Falls back to TCP transport if SHM is unavailable.
pub async fn create_event_bus(enable_shm: bool) -> anyhow::Result<Arc<dyn EventBus>> {
    let bus = ZenohBus::new(enable_shm).await?;
    Ok(bus as Arc<dyn EventBus>)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn create_event_bus_without_shm() {
        let bus = create_event_bus(false).await.unwrap();
        assert!(!bus.is_shm_active());
        assert_eq!(bus.logical_clock(), 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn factory_returns_functional_bus() {
        let bus = create_event_bus(false).await.unwrap();
        let mut rx = bus.subscribe(SESSION_MESSAGES).await.unwrap();

        let env = EventEnvelope::new(EventSource::User, 0, 0, None, b"test".to_vec());
        bus.publish(SESSION_MESSAGES, env).await.unwrap();

        let received = rx.recv().await.unwrap();
        assert_eq!(received.payload, b"test");
        assert!(bus.logical_clock() > 0);
    }
}
