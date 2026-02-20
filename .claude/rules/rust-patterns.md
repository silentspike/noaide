---
id: RUST-PATTERNS
status: Stable
paths: server/**/*.rs, wasm/**/*.rs
---

# Rust Patterns — claude-ide

## TL;DR
- IMMER `cargo remote -- build|test|clippy` (Build-Server CT 155)
- ECS (hecs): Components sind Plain Structs, Systems sind Funktionen
- Error Handling: `thiserror` fuer Library, `anyhow` nur in main
- Async: tokio mit io_uring Feature, KEIN block_on in async Context
- Logging: `tracing` crate, Structured JSON, Session-ID als Span

## ECS Patterns (hecs)

### Gut:
```rust
// Components sind Plain Structs (SoA-friendly)
#[derive(Debug, Clone)]
pub struct SessionComponent {
    pub path: PathBuf,
    pub status: SessionStatus,
    pub model: String,
}

// Systems sind Funktionen die World borrowen
pub fn update_sessions(world: &mut World) {
    for (id, (session, messages)) in world.query_mut::<(&mut SessionComponent, &MessageList)>() {
        // Fine-grained query, cache-friendly iteration
    }
}
```

### Schlecht:
```rust
// NICHT: HashMap als State
let mut sessions: HashMap<String, Session> = HashMap::new(); // O(n) Iteration, nicht cache-friendly

// NICHT: block_on in async
tokio::runtime::Runtime::new().unwrap().block_on(async { ... }); // Deadlock in Tokio!
```

## Error Handling
```rust
// Library Errors: thiserror
#[derive(Debug, thiserror::Error)]
pub enum WatcherError {
    #[error("eBPF attach failed: {0}")]
    EbpfAttach(#[from] aya::EbpfError),
    #[error("inotify fallback failed: {0}")]
    InotifyFallback(std::io::Error),
}

// Fallback Pattern
match ebpf_watcher.attach() {
    Ok(w) => w,
    Err(e) => {
        tracing::warn!("eBPF failed, falling back to inotify: {e}");
        InotifyWatcher::new()?
    }
}
```

## Zenoh Pub/Sub
```rust
// Topics
const TOPIC_SESSION_MESSAGES: &str = "session/messages";
const TOPIC_FILE_CHANGES: &str = "files/changes";
const TOPIC_TASK_UPDATES: &str = "tasks/updates";
const TOPIC_AGENT_METRICS: &str = "agents/metrics";
const TOPIC_SYSTEM_EVENTS: &str = "system/events";
```

## EventEnvelope (ALLE Events)
- Jedes Event MUSS in EventEnvelope gewrappt werden
- Lamport Clock: Monoton steigend, increment bei jedem Event
- Dedup: `dedup_key` fuer Echo-Prevention (PTY Input → JSONL Echo)

## Performance Rules
- Kein `.clone()` auf Hot Path (FlatBuffers zero-copy nutzen)
- Bounded Channels: `tokio::sync::mpsc::channel(500)` fuer file.change
- Unbounded NUR fuer message.new und tool.result
