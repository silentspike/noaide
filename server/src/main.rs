use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::routing::get;
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tracing::info;
use uuid::Uuid;

use noaide_server::bus::{self, EventEnvelope, EventSource};
use noaide_server::db::Db;
use noaide_server::discovery::SessionScanner;
use noaide_server::ecs::components::{SessionComponent, SessionStatus};
use noaide_server::ecs::{EcsWorld, SharedEcsWorld};
use noaide_server::parser;
use noaide_server::transport::TransportServer;
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

    // Event Bus (Zenoh)
    let enable_shm = std::env::var("ENABLE_SHM")
        .map(|v| v != "false")
        .unwrap_or(true);
    let event_bus = bus::create_event_bus(enable_shm).await?;
    info!(shm = event_bus.is_shm_active(), "event bus initialized");

    // ECS World
    let ecs = EcsWorld::new().shared();

    // Database
    let db_path = std::env::var("NOAIDE_DB_PATH").unwrap_or_else(|_| "/data/noaide/ide.db".into());
    let _db = Db::open(&db_path).await?;

    // ── Start HTTP API + Transport IMMEDIATELY (before parsing) ─────────────

    // Transport Server (QUIC/WebTransport)
    let port: u16 = std::env::var("NOAIDE_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4433);
    let bind_addr: SocketAddr = format!("0.0.0.0:{port}").parse()?;

    let transport = TransportServer::new_self_signed(bind_addr, event_bus.clone())?;
    let cert_hash_b64 = transport.cert_hash_base64();
    info!(port, cert_hash = %cert_hash_b64, "transport server started (self-signed)");

    // HTTP API server
    let http_port: u16 = std::env::var("NOAIDE_HTTP_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);

    let cert_hash_json = Arc::new(serde_json::json!({
        "algorithm": "sha-256",
        "hash": cert_hash_b64,
    }));

    let cert_json = cert_hash_json.clone();
    let ecs_for_api = ecs.clone();
    let app = Router::new()
        .route(
            "/api/cert-hash",
            get(move || {
                let json = cert_json.clone();
                async move { axum::Json(json.as_ref().clone()) }
            }),
        )
        .route("/api/sessions", get(api_get_sessions))
        .route("/api/sessions/{id}/messages", get(api_get_messages))
        .route("/health", get(|| async { "ok" }))
        .with_state(ecs_for_api)
        .layer(CorsLayer::permissive())
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::HeaderName::from_static("cross-origin-resource-policy"),
            HeaderValue::from_static("cross-origin"),
        ));

    let http_addr: SocketAddr = format!("0.0.0.0:{http_port}").parse()?;
    let listener = tokio::net::TcpListener::bind(http_addr).await?;
    info!(port = http_port, "http api server listening");

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!(error = %e, "http api server error");
        }
    });

    // Run transport in background
    tokio::spawn(async move {
        if let Err(e) = transport.run().await {
            tracing::error!(error = %e, "transport server error");
        }
    });

    info!("servers ready — starting background session discovery");

    // ── File Watcher ────────────────────────────────────────────────────────

    let enable_ebpf = std::env::var("ENABLE_EBPF")
        .map(|v| v != "false")
        .unwrap_or(true);
    let watcher = noaide_server::watcher::create_watcher(enable_ebpf)?;
    info!(backend = watcher.backend_name(), "file watcher created");

    let watch_paths = std::env::var("NOAIDE_WATCH_PATHS").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
        format!("{home}/.claude:{home}/.codex:{home}/.gemini")
    });

    let mut cli_dirs: Vec<PathBuf> = Vec::new();
    for path_str in watch_paths.split(':') {
        let path = PathBuf::from(path_str);
        if path.exists() {
            watcher.watch(&path).await?;
            cli_dirs.push(path.clone());
            info!(path = %path.display(), "watching directory");
        } else {
            tracing::warn!(path = %path.display(), "watch path does not exist, skipping");
        }
    }

    // ── Session Discovery — scan ALL CLI session files ──────────────────────

    // Phase 1: Discover sessions (fast — only filesystem metadata)
    let mut all_sessions = Vec::new();
    for dir in &cli_dirs {
        let sessions = SessionScanner::scan(dir).await?;
        info!(cli_dir = %dir.display(), count = sessions.len(), "discovered sessions");
        all_sessions.extend(sessions);
    }

    // Phase 2: Register sessions in ECS (fast — no parsing yet)
    {
        let mut world = ecs.write().await;
        for session_info in &all_sessions {
            let session_id = match Uuid::parse_str(&session_info.id) {
                Ok(id) => id,
                Err(_) => continue,
            };
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
        }
        info!(
            sessions = world.session_count(),
            "sessions registered (parsing in background)"
        );
    }

    // Phase 3: Parse messages in background — PARALLEL on all cores
    let offsets = Arc::new(tokio::sync::Mutex::new(HashMap::<PathBuf, u64>::new()));
    {
        let ecs_parse = ecs.clone();
        let bus_parse = event_bus.clone();
        let sessions_to_parse = all_sessions.clone();
        let offsets_bg = offsets.clone();

        tokio::spawn(async move {
            // Parse sessions in batches to use all cores
            let parallelism = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4);
            let semaphore = Arc::new(tokio::sync::Semaphore::new(parallelism));
            let mut handles = Vec::new();

            for session_info in sessions_to_parse {
                let session_id = match Uuid::parse_str(&session_info.id) {
                    Ok(id) => id,
                    Err(_) => continue,
                };

                let permit = semaphore.clone().acquire_owned().await.unwrap();
                let ecs_h = ecs_parse.clone();
                let bus_h = bus_parse.clone();
                let offsets_h = offsets_bg.clone();
                let path = session_info.jsonl_path.clone();
                let size = session_info.size_bytes;

                handles.push(tokio::spawn(async move {
                    let _permit = permit; // held until task completes

                    match parser::parse_file(&path).await {
                        Ok(messages) => {
                            let mut world = ecs_h.write().await;
                            let mut msg_count = 0;
                            for msg in &messages {
                                if let Some(component) =
                                    parser::message_to_component(msg, session_id)
                                {
                                    world.spawn_message(component);
                                    msg_count += 1;
                                }
                            }
                            drop(world); // release write lock ASAP

                            offsets_h.lock().await.insert(path, size);

                            if msg_count > 0 {
                                let payload = serde_json::to_vec(&serde_json::json!({
                                    "type": "session_loaded",
                                    "session_id": session_id.to_string(),
                                    "message_count": msg_count,
                                }))
                                .unwrap_or_default();
                                let envelope =
                                    EventEnvelope::new(EventSource::Jsonl, 0, 0, None, payload);
                                let _ = bus_h.publish(bus::SESSION_MESSAGES, envelope).await;
                            }

                            msg_count
                        }
                        Err(e) => {
                            tracing::warn!(
                                session = %session_id,
                                error = %e,
                                "failed to parse session"
                            );
                            0
                        }
                    }
                }));
            }

            // Wait for all parsing tasks
            let mut total_msgs = 0usize;
            for handle in handles {
                if let Ok(count) = handle.await {
                    total_msgs += count;
                }
            }

            info!(total_messages = total_msgs, "background parsing complete");
        });
    }

    // ── Watcher event loop — react to live file changes ─────────────────────

    let ecs_handle = ecs.clone();
    let bus_handle = event_bus.clone();
    let offsets_watch = offsets.clone();
    let mut events_rx = watcher.events();
    tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(event) => {
                    let path = &event.path;
                    let is_jsonl = path.extension().map(|ext| ext == "jsonl").unwrap_or(false);
                    if !is_jsonl {
                        continue;
                    }

                    match event.kind {
                        FileEventKind::Created | FileEventKind::Modified => {
                            let from_offset =
                                { offsets_watch.lock().await.get(path).copied().unwrap_or(0) };
                            match parser::parse_incremental(path, from_offset).await {
                                Ok((messages, new_offset)) => {
                                    if !messages.is_empty() {
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
                                            drop(world);

                                            if new_msgs > 0 {
                                                let payload =
                                                    serde_json::to_vec(&serde_json::json!({
                                                        "type": "new_messages",
                                                        "session_id": sid.to_string(),
                                                        "count": new_msgs,
                                                    }))
                                                    .unwrap_or_default();
                                                let envelope = EventEnvelope::new(
                                                    EventSource::Jsonl,
                                                    0,
                                                    0,
                                                    None,
                                                    payload,
                                                );
                                                let _ = bus_handle
                                                    .publish(bus::SESSION_MESSAGES, envelope)
                                                    .await;
                                                tracing::debug!(
                                                    session = %sid,
                                                    new_messages = new_msgs,
                                                    "incremental parse"
                                                );
                                            }
                                        }
                                    }
                                    offsets_watch.lock().await.insert(path.clone(), new_offset);
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
                            offsets_watch.lock().await.remove(path);
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

// ── HTTP API Handlers ───────────────────────────────────────────────────────

async fn api_get_sessions(State(ecs): State<SharedEcsWorld>) -> axum::Json<serde_json::Value> {
    let world = ecs.read().await;
    let sessions = world.query_sessions();
    let json: Vec<serde_json::Value> = sessions
        .iter()
        .map(|s| {
            let message_count = world.query_messages_by_session(s.id).len();
            serde_json::json!({
                "id": s.id.to_string(),
                "path": s.path,
                "status": format!("{:?}", s.status).to_lowercase(),
                "model": s.model,
                "startedAt": s.started_at,
                "cost": s.cost,
                "messageCount": message_count,
            })
        })
        .collect();
    axum::Json(serde_json::json!(json))
}

async fn api_get_messages(
    State(ecs): State<SharedEcsWorld>,
    Path(id): Path<String>,
) -> axum::Json<serde_json::Value> {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return axum::Json(serde_json::json!({"error": "invalid session id"}));
    };
    let world = ecs.read().await;
    let messages = world.query_messages_by_session(uuid);
    let json: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            // Parse stored content_blocks_json back to structured JSON
            let content_blocks = m
                .content_blocks_json
                .as_ref()
                .and_then(|json_str| serde_json::from_str::<serde_json::Value>(json_str).ok());

            serde_json::json!({
                "uuid": m.id.to_string(),
                "sessionId": m.session_id.to_string(),
                "role": format!("{:?}", m.role).to_lowercase(),
                "content": m.content,
                "contentBlocks": content_blocks,
                "timestamp": m.timestamp,
                "tokens": m.tokens,
                "hidden": m.hidden,
                "messageType": format!("{:?}", m.message_type),
                "model": m.model,
                "stopReason": m.stop_reason,
                "inputTokens": m.input_tokens,
                "outputTokens": m.output_tokens,
                "cacheCreationInputTokens": m.cache_creation_input_tokens,
                "cacheReadInputTokens": m.cache_read_input_tokens,
            })
        })
        .collect();
    axum::Json(serde_json::json!(json))
}
