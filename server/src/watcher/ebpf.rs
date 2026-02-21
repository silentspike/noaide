use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use aya::Ebpf;
use aya::maps::RingBuf;
use aya::programs::TracePoint;
use noaide_common::{BpfFileEvent, OP_CREATE, OP_DELETE, OP_MODIFY};
use tokio::sync::{RwLock, broadcast};
use tokio::task::JoinHandle;

use super::events::{FileEvent, FileEventKind};
use super::{Watcher, WatcherError};

/// eBPF-based file watcher with PID attribution.
///
/// Attaches to syscall tracepoints (openat, write, unlinkat) to detect
/// file create/modify/delete events with the PID of the triggering process.
///
/// Requires CAP_BPF or CAP_SYS_ADMIN to load eBPF programs.
pub struct EbpfWatcher {
    tx: broadcast::Sender<FileEvent>,
    watched_paths: Arc<RwLock<HashSet<PathBuf>>>,
    _event_loop: JoinHandle<()>,
}

impl EbpfWatcher {
    /// Create a new eBPF watcher.
    ///
    /// Loads the eBPF bytecode, attaches tracepoints, and starts the event loop.
    /// Returns `Err` if eBPF is not available (missing capabilities, unsupported kernel).
    pub fn new(capacity: usize) -> Result<Self, WatcherError> {
        let (tx, _) = broadcast::channel(capacity);
        let watched_paths = Arc::new(RwLock::new(HashSet::new()));

        // Load eBPF bytecode embedded at compile time
        let mut ebpf = Ebpf::load(Self::ebpf_bytecode()).map_err(WatcherError::EbpfLoad)?;

        // Initialize aya-log for kernel-side logging
        if let Err(e) = aya_log::EbpfLogger::init(&mut ebpf) {
            tracing::debug!(error = %e, "eBPF logger init failed (non-fatal)");
        }

        // Attach tracepoints
        Self::attach_tracepoint(&mut ebpf, "trace_openat", "syscalls", "sys_enter_openat")?;
        Self::attach_tracepoint(&mut ebpf, "trace_write", "syscalls", "sys_exit_write")?;
        Self::attach_tracepoint(
            &mut ebpf,
            "trace_unlinkat",
            "syscalls",
            "sys_enter_unlinkat",
        )?;

        // Start event consumer loop
        let tx_clone = tx.clone();
        let paths_clone = watched_paths.clone();
        let event_loop = tokio::spawn(async move {
            if let Err(e) = Self::run_event_loop(ebpf, tx_clone, paths_clone).await {
                tracing::error!(error = %e, "eBPF event loop terminated");
            }
        });

        tracing::info!("eBPF watcher initialized (3 tracepoints attached)");

        Ok(Self {
            tx,
            watched_paths,
            _event_loop: event_loop,
        })
    }

    fn ebpf_bytecode() -> &'static [u8] {
        // The eBPF bytecode is embedded at compile time via build.rs.
        // If the file doesn't exist (eBPF not built), this will be an empty slice
        // and Ebpf::load will return an error.
        include_bytes!(concat!(env!("OUT_DIR"), "/noaide-ebpf"))
    }

    fn attach_tracepoint(
        ebpf: &mut Ebpf,
        prog_name: &str,
        category: &str,
        name: &str,
    ) -> Result<(), WatcherError> {
        let prog: &mut TracePoint = ebpf
            .program_mut(prog_name)
            .ok_or_else(|| WatcherError::EbpfProgram(prog_name.to_string()))?
            .try_into()
            .map_err(|e| WatcherError::EbpfAttach(format!("{prog_name}: {e}")))?;
        prog.load()
            .map_err(|e| WatcherError::EbpfAttach(format!("{prog_name} load: {e}")))?;
        prog.attach(category, name).map_err(|e| {
            WatcherError::EbpfAttach(format!("{prog_name} attach {category}/{name}: {e}"))
        })?;
        tracing::debug!(program = prog_name, tracepoint = %format!("{category}/{name}"), "tracepoint attached");
        Ok(())
    }

    async fn run_event_loop(
        mut ebpf: Ebpf,
        tx: broadcast::Sender<FileEvent>,
        watched_paths: Arc<RwLock<HashSet<PathBuf>>>,
    ) -> anyhow::Result<()> {
        let ring_buf = RingBuf::try_from(ebpf.map_mut("EVENTS").expect("EVENTS map not found"))?;

        // RingBuf is already the correct type from try_from
        let mut poll_ring = ring_buf;

        loop {
            // Poll for events (non-blocking check + sleep)
            while let Some(item) = poll_ring.next() {
                if item.len() < std::mem::size_of::<BpfFileEvent>() {
                    continue;
                }

                let bpf_event: BpfFileEvent =
                    unsafe { std::ptr::read_unaligned(item.as_ptr() as *const BpfFileEvent) };

                let kind = match bpf_event.op {
                    OP_CREATE => FileEventKind::Created,
                    OP_MODIFY => FileEventKind::Modified,
                    OP_DELETE => FileEventKind::Deleted,
                    _ => continue,
                };

                // Resolve path from BPF event
                let path = if bpf_event.path_len > 0 {
                    let len = (bpf_event.path_len as usize).min(bpf_event.path.len());
                    let path_str = std::str::from_utf8(&bpf_event.path[..len])
                        .unwrap_or("")
                        .trim_end_matches('\0');
                    PathBuf::from(path_str)
                } else {
                    // For write events, path is not available from eBPF
                    continue;
                };

                // Filter: only emit events for watched paths
                let watched = watched_paths.read().await;
                let is_watched = watched.iter().any(|wp| path.starts_with(wp));
                if !is_watched {
                    continue;
                }

                let event = FileEvent {
                    path,
                    kind,
                    pid: Some(bpf_event.pid),
                    timestamp: Instant::now(),
                };

                let _ = tx.send(event);
            }

            // Sleep briefly to avoid busy-spinning
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }
}

#[async_trait::async_trait]
impl Watcher for EbpfWatcher {
    async fn watch(&self, path: &Path) -> anyhow::Result<()> {
        let canonical = path.canonicalize()?;
        self.watched_paths.write().await.insert(canonical.clone());
        tracing::debug!(path = %canonical.display(), "eBPF watching");
        Ok(())
    }

    async fn unwatch(&self, path: &Path) -> anyhow::Result<()> {
        let canonical = path.canonicalize()?;
        self.watched_paths.write().await.remove(&canonical);
        tracing::debug!(path = %canonical.display(), "eBPF unwatched");
        Ok(())
    }

    fn events(&self) -> broadcast::Receiver<FileEvent> {
        self.tx.subscribe()
    }

    fn backend_name(&self) -> &'static str {
        "ebpf"
    }
}
