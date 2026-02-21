use std::collections::HashMap;
use std::path::PathBuf;

use tracing::info;
use uuid::Uuid;

use noaide_server::db::Db;
use noaide_server::discovery::SessionScanner;
use noaide_server::ecs::EcsWorld;
use noaide_server::ecs::components::{SessionComponent, SessionStatus};
use noaide_server::parser;
use noaide_server::watcher::FileEventKind;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    info!("noaide-server starting");

    // ECS World
    let ecs = EcsWorld::new().shared();
    info!(sessions = 0, messages = 0, "ecs world initialized");

    // Database
    let db_path = std::env::var("NOAIDE_DB_PATH").unwrap_or_else(|_| "/data/noaide/ide.db".into());
    let _db = Db::open(&db_path).await?;

    // File Watcher
    let enable_ebpf = std::env::var("ENABLE_EBPF")
        .map(|v| v != "false")
        .unwrap_or(true);
    let watcher = noaide_server::watcher::create_watcher(enable_ebpf)?;
    info!(backend = watcher.backend_name(), "file watcher created");

    let watch_paths = std::env::var("NOAIDE_WATCH_PATHS").unwrap_or_else(|_| {
        std::env::var("HOME")
            .map(|h| format!("{h}/.claude"))
            .unwrap_or_else(|_| "/root/.claude".into())
    });
    let claude_dir = PathBuf::from(&watch_paths.split(':').next().unwrap_or("/root/.claude"));
    for path_str in watch_paths.split(':') {
        let path = PathBuf::from(path_str);
        if path.exists() {
            watcher.watch(&path).await?;
            info!(path = %path.display(), "watching directory");
        } else {
            tracing::warn!(path = %path.display(), "watch path does not exist, skipping");
        }
    }

    // Session Discovery — scan existing JSONL files
    let sessions = SessionScanner::scan(&claude_dir).await?;
    info!(count = sessions.len(), "discovered existing sessions");

    // Parse discovered sessions into ECS
    let mut offsets: HashMap<PathBuf, u64> = HashMap::new();
    {
        let mut world = ecs.write().await;
        for session_info in &sessions {
            let session_id = match Uuid::parse_str(&session_info.id) {
                Ok(id) => id,
                Err(_) => continue,
            };

            // Spawn session entity
            world.spawn_session(SessionComponent {
                id: session_id,
                path: session_info
                    .project_path
                    .as_ref()
                    .map(|p| p.display().to_string())
                    .unwrap_or_default(),
                status: SessionStatus::Idle,
                model: None,
                started_at: session_info
                    .last_modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0),
                cost: None,
            });

            // Parse JSONL file and spawn messages
            match parser::parse_file(&session_info.jsonl_path).await {
                Ok(messages) => {
                    let mut msg_count = 0;
                    for msg in &messages {
                        if let Some(component) = parser::message_to_component(msg, session_id) {
                            world.spawn_message(component);
                            msg_count += 1;
                        }
                    }
                    info!(
                        session = %session_id,
                        messages = msg_count,
                        "parsed session JSONL"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        session = %session_id,
                        error = %e,
                        "failed to parse session JSONL"
                    );
                }
            }

            // Store file size as initial offset for incremental parsing
            offsets.insert(session_info.jsonl_path.clone(), session_info.size_bytes);
        }

        info!(
            sessions = world.session_count(),
            messages = world.message_count(),
            "initial session load complete"
        );
    }

    // Watcher event loop — react to JSONL file changes
    let ecs_handle = ecs.clone();
    let mut events_rx = watcher.events();
    tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(event) => {
                    // Only process .jsonl file events
                    let path = &event.path;
                    let is_jsonl = path.extension().map(|ext| ext == "jsonl").unwrap_or(false);
                    if !is_jsonl {
                        continue;
                    }

                    match event.kind {
                        FileEventKind::Created | FileEventKind::Modified => {
                            let from_offset = offsets.get(path).copied().unwrap_or(0);
                            match parser::parse_incremental(path, from_offset).await {
                                Ok((messages, new_offset)) => {
                                    if !messages.is_empty() {
                                        // Extract session UUID from filename
                                        let session_id = path
                                            .file_stem()
                                            .and_then(|s| s.to_str())
                                            .and_then(|s| Uuid::parse_str(s).ok());

                                        if let Some(sid) = session_id {
                                            let mut world = ecs_handle.write().await;
                                            let mut new_msgs = 0;
                                            for msg in &messages {
                                                if let Some(component) =
                                                    parser::message_to_component(msg, sid)
                                                {
                                                    world.spawn_message(component);
                                                    new_msgs += 1;
                                                }
                                            }
                                            if new_msgs > 0 {
                                                tracing::debug!(
                                                    session = %sid,
                                                    new_messages = new_msgs,
                                                    "incremental parse"
                                                );
                                            }
                                        }
                                    }
                                    offsets.insert(path.clone(), new_offset);
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        path = %path.display(),
                                        error = %e,
                                        "incremental parse failed"
                                    );
                                }
                            }
                        }
                        FileEventKind::Deleted => {
                            offsets.remove(path);
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(missed = n, "watcher event receiver lagged");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    info!("watcher event channel closed, stopping parser loop");
                    break;
                }
            }
        }
    });

    // Keep handles alive
    let _watcher = watcher;

    info!("noaide-server ready");

    // Wait for shutdown signal
    tokio::signal::ctrl_c().await?;
    info!("noaide-server shutting down");

    Ok(())
}
