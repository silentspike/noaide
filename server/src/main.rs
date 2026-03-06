use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::routing::{delete, get, post};
use tokio::sync::RwLock;
use tokio_stream::StreamExt as _;
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tracing::{debug, info, warn};
use uuid::Uuid;

use noaide_server::bus::{self, EventEnvelope, EventSource};
use noaide_server::db::Db;
use noaide_server::discovery::{self, SessionScanner};
use noaide_server::ecs::components::{ApiRequestComponent, SessionComponent, SessionStatus};
use noaide_server::ecs::{EcsWorld, SharedEcsWorld};
use noaide_server::parser;
use noaide_server::session::SessionManager;
use noaide_server::teams::{TeamDiscovery, TopologyBuilder};
use noaide_server::transport::TransportServer;
use noaide_server::watcher::FileEventKind;

/// Shared application state for HTTP API handlers.
#[derive(Clone)]
struct AppState {
    ecs: SharedEcsWorld,
    /// Maps session UUID → JSONL file path for append operations.
    session_paths: Arc<RwLock<HashMap<Uuid, PathBuf>>>,
    /// Maps session UUID → CLI type (Claude/Codex/Gemini) for parser dispatch.
    session_cli_types: Arc<RwLock<HashMap<Uuid, noaide_server::discovery::scanner::CliType>>>,
    /// API proxy state with captured request storage.
    proxy: Arc<noaide_server::proxy::ProxyState>,
    /// Managed session manager (PTY-spawned CLI processes).
    session_manager: Arc<RwLock<SessionManager>>,
    /// Base URL for the API proxy (e.g. "http://localhost:4434").
    proxy_base_url: Arc<String>,
    /// Maps working directory path → managed session UUID.
    /// Used by the file watcher to link JSONL sessions (Claude) to their managed parent.
    managed_session_paths: Arc<RwLock<HashMap<String, Uuid>>>,
    /// Maps CLI type ("codex", "gemini") → most recent unlinked managed session UUID.
    /// Fallback matching for CLIs that don't encode the project path in their JSONL path.
    managed_pending_by_cli: Arc<RwLock<HashMap<String, Uuid>>>,
    /// Message count hints from discovery scanner (for Codex/Gemini sessions where
    /// messages aren't stored in the ECS world).
    message_count_hints: Arc<RwLock<HashMap<Uuid, usize>>>,
    /// Event bus for SSE subscriptions (fallback when WebTransport unavailable).
    event_bus: Arc<dyn bus::EventBus>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    info!("noaide-server starting");

    // Prometheus metrics recorder (renders at GET /metrics)
    let recorder = metrics_exporter_prometheus::PrometheusBuilder::new().build_recorder();
    let prometheus_handle = recorder.handle();
    metrics::set_global_recorder(recorder).ok();

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
    let db = Arc::new(Db::open(&db_path).await?);

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
    let session_paths: Arc<RwLock<HashMap<Uuid, PathBuf>>> = Arc::new(RwLock::new(HashMap::new()));

    // API Proxy State (in-memory captured requests)
    let (proxy_state, proxy_rx) = noaide_server::proxy::create_proxy_state();

    // Recovery: load persisted proxy requests from DB into in-memory cache
    match db.get_all_api_requests().await {
        Ok(persisted) => {
            if !persisted.is_empty() {
                let mut cap = proxy_state.captured.write().await;
                for component in &persisted {
                    cap.push_back(component_to_proxy_log(component));
                }
                info!(count = persisted.len(), "recovered proxy requests from DB");
            }
        }
        Err(e) => {
            warn!(error = %e, "failed to load proxy requests from DB (fresh schema?)");
        }
    }

    let proxy_port: u16 = std::env::var("NOAIDE_PROXY_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4434);
    let proxy_base_url = format!("http://localhost:{proxy_port}");

    let session_cli_types: Arc<RwLock<HashMap<Uuid, noaide_server::discovery::scanner::CliType>>> =
        Arc::new(RwLock::new(HashMap::new()));
    let managed_session_paths: Arc<RwLock<HashMap<String, Uuid>>> =
        Arc::new(RwLock::new(HashMap::new()));
    let managed_pending_by_cli: Arc<RwLock<HashMap<String, Uuid>>> =
        Arc::new(RwLock::new(HashMap::new()));
    let message_count_hints: Arc<RwLock<HashMap<Uuid, usize>>> =
        Arc::new(RwLock::new(HashMap::new()));
    let app_state = AppState {
        ecs: ecs.clone(),
        session_paths: session_paths.clone(),
        session_cli_types: session_cli_types.clone(),
        proxy: proxy_state.clone(),
        session_manager: Arc::new(RwLock::new(SessionManager::new())),
        proxy_base_url: Arc::new(proxy_base_url),
        managed_session_paths: managed_session_paths.clone(),
        managed_pending_by_cli: managed_pending_by_cli.clone(),
        message_count_hints: message_count_hints.clone(),
        event_bus: event_bus.clone(),
    };
    let app = Router::new()
        .route(
            "/api/cert-hash",
            get(move || {
                let json = cert_json.clone();
                async move { axum::Json(json.as_ref().clone()) }
            }),
        )
        .route("/api/sessions", get(api_get_sessions))
        .route("/api/sessions/managed", post(api_create_managed_session))
        .route("/api/sessions/{id}/messages", get(api_get_messages))
        .route("/api/sessions/{id}/append", post(api_append_message))
        .route("/api/sessions/{id}/send", post(api_send_message))
        .route("/api/sessions/{id}/input", post(api_send_input))
        .route("/api/sessions/{id}/close", post(api_close_session))
        .route("/api/proxy/requests", get(api_get_proxy_requests))
        .route("/api/proxy/requests", delete(api_clear_proxy_requests))
        .route(
            "/api/proxy/requests/{id}",
            get(api_get_proxy_request_detail),
        )
        .route(
            "/api/proxy/intercept/{session_id}",
            get(api_get_intercept_status),
        )
        .route(
            "/api/proxy/intercept/{session_id}",
            post(api_set_intercept_mode),
        )
        .route(
            "/api/proxy/intercept/{session_id}/pending",
            get(api_get_pending_intercepts),
        )
        .route(
            "/api/proxy/intercept/{session_id}/pending/{id}/body",
            get(api_get_pending_body),
        )
        .route(
            "/api/proxy/intercept/{session_id}/pending/{id}/forward",
            post(api_forward_intercept),
        )
        .route(
            "/api/proxy/intercept/{session_id}/pending/{id}/drop",
            post(api_drop_intercept),
        )
        .route(
            "/api/proxy/intercept/{session_id}/pending-responses",
            get(api_get_pending_response_intercepts),
        )
        .route(
            "/api/proxy/intercept/{session_id}/pending-responses/{id}/body",
            get(api_get_pending_response_body),
        )
        .route(
            "/api/proxy/intercept/{session_id}/pending-responses/{id}/forward",
            post(api_forward_response_intercept),
        )
        .route("/api/git/status", get(api_git_status))
        .route("/api/git/branches", get(api_git_branches))
        .route("/api/git/log", get(api_git_log))
        .route("/api/git/blame", get(api_git_blame))
        .route("/api/git/checkout", post(api_git_checkout))
        .route("/api/git/stage", post(api_git_stage))
        .route("/api/git/commit", post(api_git_commit))
        .route("/api/teams", get(api_get_teams))
        .route("/api/teams/{name}/topology", get(api_get_team_topology))
        .route("/api/events", get(api_sse_events))
        .route("/health", get(|| async { "ok" }))
        .route(
            "/metrics",
            get({
                let handle = prometheus_handle.clone();
                move || {
                    let h = handle.clone();
                    async move { h.render() }
                }
            }),
        )
        .with_state(app_state)
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

    // API Proxy Server (intercepting Claude API calls on separate port)
    let proxy_handle = proxy_state;
    tokio::spawn(async move {
        if let Err(e) = noaide_server::proxy::start_proxy(proxy_handle).await {
            tracing::error!(error = %e, "proxy server error");
        }
    });

    // Proxy → DB persistence: listen on broadcast channel, write to Limbo
    {
        let db_persist = db.clone();
        let mut rx = proxy_rx;
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(log) => {
                        let component = proxy_log_to_component(&log);
                        if let Err(e) = db_persist.insert_api_request(&component).await {
                            tracing::warn!(
                                id = log.id,
                                error = %e,
                                "failed to persist proxy request to DB"
                            );
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(missed = n, "proxy DB listener lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        info!("proxy broadcast channel closed");
                        break;
                    }
                }
            }
        });
    }

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
        let mut paths = session_paths.write().await;
        let mut cli_types = session_cli_types.write().await;
        let mut hints = message_count_hints.write().await;
        for session_info in &all_sessions {
            let session_id = match Uuid::parse_str(&session_info.id) {
                Ok(id) => id,
                Err(_) => continue,
            };
            paths.insert(session_id, session_info.jsonl_path.clone());
            cli_types.insert(session_id, session_info.cli_type);
            if session_info.message_count_hint > 0 {
                hints.insert(session_id, session_info.message_count_hint);
            }
            world.spawn_session(SessionComponent {
                id: session_id,
                path: session_info
                    .project_path
                    .as_ref()
                    .map(|p| p.display().to_string())
                    .unwrap_or_default(),
                status: SessionStatus::Idle,
                model: None,
                started_at: session_info.started_at,
                last_activity_at: session_info.last_activity_at,
                cost: None,
            });
        }
        info!(
            sessions = world.session_count(),
            "sessions registered (parsing in background)"
        );
    }

    // Phase 3: Pre-populate offsets SYNCHRONOUSLY so the watcher event loop
    // (which starts immediately after) doesn't parse files from offset 0.
    // Without this, active sessions get full-file-parsed during the race window
    // between watcher start and background offset population — causing 1+ GB RSS spikes.
    let offsets = Arc::new(tokio::sync::Mutex::new(HashMap::<PathBuf, u64>::new()));
    {
        let mut offset_map = offsets.lock().await;
        let mut total_msgs = 0usize;
        for session_info in &all_sessions {
            let msg_count = (session_info.size_bytes / 1500).max(1) as usize;
            offset_map.insert(session_info.jsonl_path.clone(), session_info.size_bytes);
            total_msgs += msg_count;
        }
        info!(
            total_messages = total_msgs,
            sessions = all_sessions.len(),
            "offsets pre-populated (watcher will only see new content)"
        );
    }

    // Phase 4: Publish session_loaded events in background (non-blocking)
    {
        let bus_parse = event_bus.clone();
        let sessions_to_publish = all_sessions.clone();

        tokio::spawn(async move {
            for session_info in sessions_to_publish {
                let session_id = match Uuid::parse_str(&session_info.id) {
                    Ok(id) => id,
                    Err(_) => continue,
                };
                let msg_count = (session_info.size_bytes / 1500).max(1) as usize;
                if msg_count > 0 {
                    let payload = serde_json::to_vec(&serde_json::json!({
                        "type": "session_loaded",
                        "session_id": session_id.to_string(),
                        "message_count": msg_count,
                    }))
                    .unwrap_or_default();
                    let envelope =
                        EventEnvelope::new(EventSource::Jsonl, 0, 0, Some(session_id), payload);
                    let _ = bus_parse.publish(bus::SESSION_MESSAGES, envelope).await;
                }
            }
            info!("background session_loaded events published");
        });
    }

    // ── Watcher event loop — react to live file changes ─────────────────────

    let ecs_handle = ecs.clone();
    let bus_handle = event_bus.clone();
    let offsets_watch = offsets.clone();
    let paths_watch = session_paths.clone();
    let cli_types_watch = session_cli_types.clone();
    let msp_watch = managed_session_paths.clone();
    let pending_cli_watch = managed_pending_by_cli.clone();
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
                            // Extract session UUID from filename
                            let session_id = path
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .and_then(|s| Uuid::parse_str(s).ok());

                            let Some(sid) = session_id else {
                                continue;
                            };

                            // Check if this JSONL belongs to a managed session.
                            // If so, link it (alias) instead of creating a duplicate.
                            // IMPORTANT: Only alias TRULY NEW sessions (not yet in ECS).
                            // Existing sessions that happen to share the same project path
                            // must NOT be aliased.
                            let effective_sid = {
                                let world = ecs_handle.read().await;
                                if world.is_aliased(sid) {
                                    // Already linked — use the managed session ID
                                    world.resolve_alias(sid)
                                } else {
                                    // Only attempt alias for sessions not yet registered in ECS.
                                    // If sid already exists, it's an older session being modified —
                                    // not the new CLI process spawned by the managed session.
                                    let already_registered =
                                        world.query_session_by_id(sid).is_some();
                                    drop(world);

                                    if already_registered {
                                        // Existing session — don't alias, use as-is
                                        sid
                                    } else {
                                        // Strategy 1: Match by encoded project dir name (Claude
                                        // encodes the working dir in the JSONL directory name).
                                        // Compare encoded forms to avoid lossy decode_project_dir.
                                        let encoded_dir = extract_encoded_project_dir(path);
                                        let mut managed_id = if let Some(ref ed) = encoded_dir {
                                            msp_watch.read().await.get(ed.as_str()).copied()
                                        } else {
                                            None
                                        };

                                        // Strategy 2: Match by CLI type (Codex/Gemini — their
                                        // JSONL paths don't encode the project directory)
                                        if managed_id.is_none()
                                            && let Some(cli_type) = detect_cli_type_from_path(path)
                                            && cli_type != "claude"
                                        {
                                            let pending = pending_cli_watch.read().await;
                                            managed_id = pending.get(cli_type).copied();
                                        }

                                        if let Some(mid) = managed_id {
                                            // Link JSONL session to managed session
                                            let mut world = ecs_handle.write().await;
                                            world.add_session_alias(sid, mid);
                                            info!(
                                                jsonl_session = %sid,
                                                managed_session = %mid,
                                                "linked JSONL session to managed session"
                                            );
                                            // One-shot: remove from maps so no other session
                                            // gets aliased to the same managed session
                                            if let Some(ref ed) = encoded_dir {
                                                msp_watch.write().await.remove(ed.as_str());
                                            }
                                            if let Some(cli_type) = detect_cli_type_from_path(path)
                                            {
                                                let mut pending = pending_cli_watch.write().await;
                                                if pending.get(cli_type).copied() == Some(mid) {
                                                    pending.remove(cli_type);
                                                }
                                            }
                                            mid
                                        } else {
                                            sid
                                        }
                                    }
                                }
                            };

                            // Auto-register new sessions on first encounter
                            // (only for non-aliased sessions — aliased ones already exist)
                            {
                                let world = ecs_handle.read().await;
                                let exists = world.query_session_by_id(effective_sid).is_some();
                                drop(world);

                                // Store JSONL path under the effective session ID
                                paths_watch
                                    .write()
                                    .await
                                    .insert(effective_sid, path.clone());
                                // Infer CLI type from path
                                let cli_type = cli_type_from_path(path);
                                cli_types_watch
                                    .write()
                                    .await
                                    .insert(effective_sid, cli_type);

                                if !exists {
                                    let project_path = extract_project_path_from_jsonl(path);
                                    let _metadata = tokio::fs::metadata(path).await.ok();

                                    let mut world = ecs_handle.write().await;
                                    // Double-check after acquiring write lock
                                    if world.query_session_by_id(effective_sid).is_none() {
                                        let now_epoch = std::time::SystemTime::now()
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .map(|d| d.as_secs() as i64)
                                            .unwrap_or(0);
                                        let first_ts =
                                            discovery::extract_first_timestamp(path).await;
                                        world.spawn_session(SessionComponent {
                                            id: effective_sid,
                                            path: project_path.unwrap_or_default(),
                                            status: SessionStatus::Active,
                                            model: None,
                                            started_at: if first_ts > 0 {
                                                first_ts
                                            } else {
                                                now_epoch
                                            },
                                            last_activity_at: now_epoch,
                                            cost: None,
                                        });
                                        info!(
                                            session = %effective_sid,
                                            "new session auto-registered from watcher"
                                        );
                                    }
                                }
                            }

                            // Incremental parse (use effective_sid for message attribution)
                            let from_offset =
                                { offsets_watch.lock().await.get(path).copied().unwrap_or(0) };
                            match parser::parse_incremental(path, from_offset).await {
                                Ok((messages, new_offset)) => {
                                    if !messages.is_empty() {
                                        // Update last_activity_at from the latest message timestamp.
                                        let latest_ts = messages
                                            .iter()
                                            .filter_map(|m| m.timestamp.as_deref())
                                            .filter_map(discovery::parse_iso_to_epoch_secs)
                                            .max();
                                        if let Some(ts) = latest_ts {
                                            ecs_handle
                                                .write()
                                                .await
                                                .update_last_activity_at(effective_sid, ts);
                                        }

                                        // Serialize ALL new messages for push to browser via bus.
                                        // Messages are NOT stored in ECS — the API endpoint parses
                                        // from JSONL on demand (zero-copy, no RAM overhead).
                                        let mut serialized_messages = Vec::new();
                                        for msg in &messages {
                                            if let Some(component) =
                                                parser::message_to_component(msg, effective_sid)
                                            {
                                                serialized_messages
                                                    .push(component_to_json(&component));
                                            }
                                        }

                                        if !serialized_messages.is_empty() {
                                            let payload = serde_json::to_vec(&serde_json::json!({
                                                "type": "new_messages",
                                                "session_id": effective_sid.to_string(),
                                                "count": serialized_messages.len(),
                                                "messages": serialized_messages,
                                            }))
                                            .unwrap_or_default();
                                            let envelope = EventEnvelope::new(
                                                EventSource::Jsonl,
                                                0,
                                                0,
                                                Some(effective_sid),
                                                payload,
                                            );
                                            let _ = bus_handle
                                                .publish(bus::SESSION_MESSAGES, envelope)
                                                .await;
                                            tracing::debug!(
                                                session = %effective_sid,
                                                new_messages = serialized_messages.len(),
                                                "incremental parse — pushed messages to bus"
                                            );
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

    // ── Periodic rescan — discover sessions created between watcher events ──

    let ecs_rescan = ecs.clone();
    let bus_rescan = event_bus.clone();
    let offsets_rescan = offsets.clone();
    let paths_rescan = session_paths.clone();
    let cli_types_rescan = session_cli_types.clone();
    let cli_dirs_rescan = cli_dirs.clone();
    let msp_rescan = managed_session_paths.clone();
    let pending_cli_rescan = managed_pending_by_cli.clone();
    let hints_rescan = message_count_hints.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await; // skip immediate first tick

        loop {
            interval.tick().await;

            let mut new_count = 0usize;
            for dir in &cli_dirs_rescan {
                let Ok(sessions) = SessionScanner::scan(dir).await else {
                    continue;
                };

                for session_info in sessions {
                    let Ok(sid) = Uuid::parse_str(&session_info.id) else {
                        continue;
                    };

                    // Resolve alias: if this JSONL session belongs to a managed session,
                    // redirect all data to the managed session ID.
                    // Only alias truly NEW sessions (not already registered in ECS).
                    let effective_sid = {
                        let world = ecs_rescan.read().await;
                        if world.is_aliased(sid) {
                            world.resolve_alias(sid)
                        } else {
                            let already_registered = world.query_session_by_id(sid).is_some();
                            drop(world);

                            if already_registered {
                                sid
                            } else {
                                // Strategy 1: Match by encoded project dir name (Claude)
                                let encoded_dir =
                                    extract_encoded_project_dir(&session_info.jsonl_path);
                                let mut managed_id = if let Some(ref ed) = encoded_dir {
                                    msp_rescan.read().await.get(ed.as_str()).copied()
                                } else {
                                    None
                                };

                                // Strategy 2: Match by CLI type (Codex/Gemini)
                                if managed_id.is_none()
                                    && let Some(cli_type) =
                                        detect_cli_type_from_path(&session_info.jsonl_path)
                                    && cli_type != "claude"
                                {
                                    let pending = pending_cli_rescan.read().await;
                                    managed_id = pending.get(cli_type).copied();
                                }

                                if let Some(mid) = managed_id {
                                    let mut world = ecs_rescan.write().await;
                                    if !world.is_aliased(sid) {
                                        world.add_session_alias(sid, mid);
                                        info!(
                                            jsonl_session = %sid,
                                            managed_session = %mid,
                                            "rescan: linked JSONL session to managed session"
                                        );
                                        // One-shot: remove from maps
                                        if let Some(ref ed) = encoded_dir {
                                            msp_rescan.write().await.remove(ed.as_str());
                                        }
                                        if let Some(cli_type) =
                                            detect_cli_type_from_path(&session_info.jsonl_path)
                                        {
                                            let mut pending = pending_cli_rescan.write().await;
                                            if pending.get(cli_type).copied() == Some(mid) {
                                                pending.remove(cli_type);
                                            }
                                        }
                                    }
                                    mid
                                } else {
                                    sid
                                }
                            }
                        }
                    };

                    // Always update path and CLI type mapping under the effective session ID
                    paths_rescan
                        .write()
                        .await
                        .insert(effective_sid, session_info.jsonl_path.clone());
                    cli_types_rescan
                        .write()
                        .await
                        .insert(effective_sid, session_info.cli_type);
                    if session_info.message_count_hint > 0 {
                        hints_rescan
                            .write()
                            .await
                            .insert(effective_sid, session_info.message_count_hint);
                    }

                    // Check if session already registered
                    let exists = {
                        let world = ecs_rescan.read().await;
                        world.query_session_by_id(effective_sid).is_some()
                    };

                    if exists {
                        continue;
                    }

                    // Register new session (only for non-aliased, since aliased ones already exist)
                    {
                        let mut world = ecs_rescan.write().await;
                        if world.query_session_by_id(effective_sid).is_none() {
                            world.spawn_session(SessionComponent {
                                id: effective_sid,
                                path: session_info
                                    .project_path
                                    .as_ref()
                                    .map(|p| p.display().to_string())
                                    .unwrap_or_default(),
                                status: SessionStatus::Idle,
                                model: None,
                                started_at: session_info.started_at,
                                last_activity_at: session_info.last_activity_at,
                                cost: None,
                            });
                            new_count += 1;
                        }
                    }

                    // Ultra-lightweight: estimate message count from file size.
                    let offsets_bg = offsets_rescan.clone();
                    let path = session_info.jsonl_path.clone();
                    let size = session_info.size_bytes;
                    let msg_count = (size / 1500).max(1) as usize;
                    offsets_bg.lock().await.insert(path, size);

                    if msg_count > 0 {
                        let payload = serde_json::to_vec(&serde_json::json!({
                            "type": "session_loaded",
                            "session_id": effective_sid.to_string(),
                            "message_count": msg_count,
                        }))
                        .unwrap_or_default();
                        let envelope = EventEnvelope::new(
                            EventSource::Jsonl,
                            0,
                            0,
                            Some(effective_sid),
                            payload,
                        );
                        let _ = bus_rescan.publish(bus::SESSION_MESSAGES, envelope).await;
                    }
                }
            }

            if new_count > 0 {
                info!(
                    new_sessions = new_count,
                    "periodic rescan discovered new sessions"
                );
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Detect which CLI tool owns a JSONL/JSON file based on its path.
///
/// Returns "claude", "codex", or "gemini" based on the directory structure.
fn detect_cli_type_from_path(path: &std::path::Path) -> Option<&'static str> {
    let path_str = path.to_str()?;
    if path_str.contains("/.claude/") {
        Some("claude")
    } else if path_str.contains("/.codex/") {
        Some("codex")
    } else if path_str.contains("/.gemini/") {
        Some("gemini")
    } else {
        None
    }
}

/// Extract decoded project path from a JSONL file path.
///
/// Given a path like `~/.claude/projects/-work-noaide/UUID.jsonl`,
/// extracts `-work-noaide` and decodes it to `/work/noaide`.
/// Infer CLI type from the JSONL/JSON file path.
fn cli_type_from_path(path: &std::path::Path) -> noaide_server::discovery::scanner::CliType {
    use noaide_server::discovery::scanner::CliType;
    let s = path.to_string_lossy();
    if s.contains("/.codex/") || s.contains("/codex/") {
        CliType::Codex
    } else if s.contains("/.gemini/") || s.contains("/gemini/") {
        CliType::Gemini
    } else {
        CliType::Claude
    }
}

fn extract_project_path_from_jsonl(jsonl_path: &std::path::Path) -> Option<String> {
    let parent = jsonl_path.parent()?;
    let dir_name = parent.file_name()?.to_str()?;
    // Only decode if it looks like an encoded project dir (starts with `-`)
    if dir_name.starts_with('-') {
        Some(decode_project_dir(dir_name))
    } else {
        None
    }
}

/// Decode a Claude Code project directory name back to a filesystem path.
///
/// `-work-noaide` → `/work/noaide`
/// `-home-jan` → `/home/jan`
///
/// WARNING: This decoding is lossy! Claude Code encodes `/` → `-` without
/// escaping literal hyphens. So `-tmp-test-session` could be either
/// `/tmp/test-session` or `/tmp/test/session`. Use `encode_project_dir()`
/// and compare encoded forms for reliable matching.
fn decode_project_dir(encoded: &str) -> String {
    let without_prefix = encoded.strip_prefix('-').unwrap_or(encoded);
    let mut result = String::with_capacity(without_prefix.len() + 1);
    result.push('/');

    let mut chars = without_prefix.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '-' {
            if chars.peek() == Some(&'-') {
                chars.next();
                result.push('-');
            } else {
                result.push('/');
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Encode a filesystem path into Claude Code's project directory format.
///
/// `/work/noaide` → `-work-noaide`
/// `/tmp/test-session` → `-tmp-test-session`
///
/// NOTE: This encoding is lossy (not invertible) — use for matching only.
fn encode_project_dir(path: &str) -> String {
    path.replace('/', "-")
}

/// Extract the encoded project directory name from a JSONL path without decoding.
///
/// `~/.claude/projects/-work-noaide/UUID.jsonl` → `-work-noaide`
fn extract_encoded_project_dir(jsonl_path: &std::path::Path) -> Option<String> {
    let parent = jsonl_path.parent()?;
    let dir_name = parent.file_name()?.to_str()?;
    if dir_name.starts_with('-') {
        Some(dir_name.to_string())
    } else {
        None
    }
}

// ── Claude stream-json process management ───────────────────────────────────

/// Resolve the project working directory from a session's JSONL path.
///
/// The JSONL path encodes the project: `~/.claude/projects/-work-noaide/UUID.jsonl`
/// → project CWD is `/work/noaide`.
fn resolve_session_cwd(jsonl_path: &std::path::Path) -> Option<PathBuf> {
    let project_dir = extract_project_path_from_jsonl(jsonl_path)?;
    let path = PathBuf::from(&project_dir);
    if path.is_dir() { Some(path) } else { None }
}

/// Send a message to a Claude Code session via `claude -p --resume`.
///
/// Spawns a short-lived `claude -p` process that:
/// 1. Loads the session's conversation history from JSONL (--resume)
/// 2. Receives the user message via stdin (--input-format stream-json)
/// 3. Sends it to the Anthropic API and streams the response
/// 4. Writes everything to the session's JSONL file (picked up by watcher)
///
/// The process exits after processing the message. For persistent sessions,
/// see the long-lived process management (future: managed sessions).
async fn send_via_stream_json(
    session_id: &str,
    cwd: &std::path::Path,
    text: &str,
) -> anyhow::Result<()> {
    use tokio::io::AsyncWriteExt;

    // Build the stream-json user message
    let user_message = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": text}]
        }
    });
    let input = serde_json::to_string(&user_message)?;

    info!(
        session = session_id,
        cwd = %cwd.display(),
        "spawning claude -p --resume for message delivery"
    );

    let mut child = tokio::process::Command::new("claude")
        .args([
            "-p",
            "--resume",
            session_id,
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
        ])
        .current_dir(cwd)
        .env_remove("CLAUDECODE") // avoid nested session detection
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    // Write user message to stdin and close it
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        drop(stdin); // close stdin → signals end of input
    }

    // Wait for completion with timeout (5 minutes max)
    let session_id_owned = session_id.to_string();
    tokio::spawn(async move {
        match tokio::time::timeout(std::time::Duration::from_secs(300), child.wait()).await {
            Ok(Ok(status)) => {
                if status.success() {
                    debug!(
                        session = session_id_owned,
                        "claude -p completed successfully"
                    );
                } else {
                    warn!(
                        session = session_id_owned,
                        code = ?status.code(),
                        "claude -p exited with error"
                    );
                }
            }
            Ok(Err(e)) => {
                warn!(session = session_id_owned, error = %e, "claude -p wait failed");
            }
            Err(_) => {
                warn!(
                    session = session_id_owned,
                    "claude -p timed out after 5 minutes, killing"
                );
                let _ = child.kill().await;
            }
        }
    });

    Ok(())
}

// ── HTTP API Handlers ───────────────────────────────────────────────────────

async fn api_get_sessions(State(state): State<AppState>) -> axum::Json<serde_json::Value> {
    let world = state.ecs.read().await;
    let sessions = world.query_sessions();
    let cli_types = state.session_cli_types.read().await;
    let hints = state.message_count_hints.read().await;
    let json: Vec<serde_json::Value> = sessions
        .iter()
        .map(|s| {
            let ecs_count = world.query_messages_by_session(s.id).len();
            // For Codex/Gemini sessions that aren't loaded into ECS, use the hint
            let message_count = if ecs_count > 0 {
                ecs_count
            } else {
                hints.get(&s.id).copied().unwrap_or(0)
            };
            let cli = cli_types
                .get(&s.id)
                .map(|ct| ct.as_str())
                .unwrap_or("claude");
            serde_json::json!({
                "id": s.id.to_string(),
                "path": s.path,
                "status": format!("{:?}", s.status).to_lowercase(),
                "model": s.model,
                "startedAt": s.started_at,
                "lastActivityAt": s.last_activity_at,
                "cost": s.cost,
                "messageCount": message_count,
                "cliType": cli,
            })
        })
        .collect();
    axum::Json(serde_json::json!(json))
}

#[derive(serde::Deserialize, Default)]
struct MessagesQuery {
    /// Max number of entries to return (default: all, 0 = unlimited)
    limit: Option<usize>,
    /// Offset from the END of the list (0 = last N entries)
    offset: Option<usize>,
}

async fn api_get_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<MessagesQuery>,
) -> axum::Json<serde_json::Value> {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return axum::Json(serde_json::json!({"error": "invalid session id"}));
    };

    // 0 = unlimited (return all messages)
    let limit = match query.limit {
        Some(0) | None => usize::MAX,
        Some(n) => n,
    };
    let offset = query.offset.unwrap_or(0);

    // Full Transparency: parse JSONL fresh to include ALL entry types
    // (progress, summary, file-history-snapshot, etc.) that are not stored in ECS.
    // For managed sessions: resolve reverse alias (managed_id → jsonl_id) to find JSONL path.
    let jsonl_path = {
        let paths = state.session_paths.read().await;
        match paths.get(&uuid).cloned() {
            Some(p) => Some(p),
            None => {
                // Try reverse alias: maybe this is a managed session ID
                let world = state.ecs.read().await;
                if let Some(jsonl_id) = world.reverse_alias(uuid) {
                    paths.get(&jsonl_id).cloned()
                } else {
                    None
                }
            }
        }
    };

    if let Some(path) = jsonl_path {
        // Dispatch to the right parser based on CLI type
        // Try both the requested UUID and reverse-alias (for managed sessions)
        let cli_type = {
            let types = state.session_cli_types.read().await;
            types
                .get(&uuid)
                .copied()
                .or_else(|| {
                    let world_guard = state.ecs.try_read().ok()?;
                    let jsonl_id = world_guard.reverse_alias(uuid)?;
                    types.get(&jsonl_id).copied()
                })
                .unwrap_or_default()
        };
        let parse_result = match cli_type {
            noaide_server::discovery::scanner::CliType::Codex => {
                parser::parse_codex_file(&path).await
            }
            noaide_server::discovery::scanner::CliType::Gemini => {
                parser::parse_gemini_file(&path).await
            }
            noaide_server::discovery::scanner::CliType::Claude => parser::parse_file(&path).await,
        };
        match parse_result {
            Ok(messages) => {
                let total = messages.len();
                // Paginate from the end: newest entries first by default
                let start = total.saturating_sub(offset);
                let range_start = start.saturating_sub(limit);

                let json: Vec<serde_json::Value> = messages[range_start..start]
                    .iter()
                    .filter_map(|msg| parser::message_to_component(msg, uuid))
                    .map(|m| component_to_json(&m))
                    .collect();

                return axum::Json(serde_json::json!({
                    "messages": json,
                    "total": total,
                    "offset": offset,
                    "limit": limit,
                }));
            }
            Err(e) => {
                tracing::warn!(session = %uuid, error = %e, "fresh JSONL parse failed, falling back to ECS");
            }
        }
    }

    // Fallback: serve from ECS (conversation messages only, no meta)
    let world = state.ecs.read().await;
    let messages = world.query_messages_by_session(uuid);
    let total = messages.len();
    let start = total.saturating_sub(offset);
    let range_start = start.saturating_sub(limit);
    let json: Vec<serde_json::Value> = messages[range_start..start]
        .iter()
        .map(component_to_json)
        .collect();
    axum::Json(serde_json::json!({
        "messages": json,
        "total": total,
        "offset": offset,
        "limit": limit,
    }))
}

/// Convert a MessageComponent to JSON for the API response.
fn component_to_json(m: &noaide_server::ecs::components::MessageComponent) -> serde_json::Value {
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
}

// ── Send Message Handler (stream-json) ──────────────────────────────────────

#[derive(serde::Deserialize)]
struct SendMessageRequest {
    text: String,
}

/// Send a text message to a Claude Code session via `claude -p --resume`.
///
/// Spawns a `claude -p --resume <session-id>` process with `--input-format stream-json`.
/// The process loads the session's conversation, processes the new message via the
/// Anthropic API, and writes the response to the session's JSONL file.
/// The file watcher picks up the changes for the normal streaming pipeline.
async fn api_send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<SendMessageRequest>,
) -> impl axum::response::IntoResponse {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "invalid session id"})),
        );
    };

    if body.text.is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "text must not be empty"})),
        );
    }

    // Priority 1: If this is a managed session, send via PTY input directly.
    // Managed sessions have a live PTY — no need for stream-json.
    {
        let session_id = noaide_server::session::SessionId(uuid);
        let mgr = state.session_manager.read().await;
        if let Some(session) = mgr.get(&session_id) {
            // Append carriage return so the PTY processes it as Enter key press.
            // Terminals send \r (CR) for Enter, not \n (LF).
            let text_with_newline = format!("{}\r", body.text);
            match session.send_input(&text_with_newline).await {
                Ok(()) => {
                    info!(
                        session = %uuid,
                        text_len = body.text.len(),
                        "message sent via PTY input (managed session)"
                    );
                    return (
                        axum::http::StatusCode::OK,
                        axum::Json(serde_json::json!({
                            "ok": true,
                            "method": "pty-input",
                        })),
                    );
                }
                Err(e) => {
                    warn!(
                        session = %uuid,
                        error = %e,
                        "PTY input failed for managed session"
                    );
                    return (
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        axum::Json(serde_json::json!({
                            "error": format!("PTY input failed: {e}")
                        })),
                    );
                }
            }
        }
    }

    // Priority 2: Observed session — look up JSONL path → stream-json
    let jsonl_path = {
        let paths = state.session_paths.read().await;
        paths.get(&uuid).cloned()
    };

    let Some(jsonl_path) = jsonl_path else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "session not found"})),
        );
    };

    let cwd = match resolve_session_cwd(&jsonl_path) {
        Some(cwd) => cwd,
        None => {
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({
                    "error": "could not resolve project directory from session path"
                })),
            );
        }
    };

    // Spawn claude -p --resume to deliver the message
    match send_via_stream_json(&id, &cwd, &body.text).await {
        Ok(()) => {
            info!(
                session = %uuid,
                cwd = %cwd.display(),
                text_len = body.text.len(),
                "message sent via stream-json"
            );
            (
                axum::http::StatusCode::OK,
                axum::Json(serde_json::json!({
                    "ok": true,
                    "method": "stream-json",
                    "cwd": cwd.display().to_string(),
                })),
            )
        }
        Err(e) => {
            warn!(
                session = %uuid,
                error = %e,
                "stream-json send failed"
            );
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({
                    "error": format!("failed to spawn claude: {}", e)
                })),
            )
        }
    }
}

// ── Create Managed Session Handler ───────────────────────────────────────────

#[derive(serde::Deserialize)]
struct CreateManagedSessionRequest {
    working_dir: String,
    /// CLI type to spawn: "claude" (default), "codex", or "gemini".
    cli_type: Option<String>,
}

/// Spawn a new managed CLI session (claude, codex, or gemini) via PTY.
///
/// The session process gets per-session proxy URLs (`ANTHROPIC_BASE_URL`,
/// `OPENAI_BASE_URL`, `CODE_ASSIST_ENDPOINT`) so all API traffic is
/// routed through the noaide proxy and attributed to the session.
async fn api_create_managed_session(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<CreateManagedSessionRequest>,
) -> impl axum::response::IntoResponse {
    let working_dir = PathBuf::from(&body.working_dir);
    if !working_dir.is_dir() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(
                serde_json::json!({"error": "working_dir does not exist or is not a directory"}),
            ),
        );
    }

    let cli_type = body.cli_type.as_deref().unwrap_or("claude");
    let base_url = state.proxy_base_url.as_str();
    let mut mgr = state.session_manager.write().await;
    match mgr.spawn_managed(&working_dir, Some(base_url), cli_type) {
        Ok(session_id) => {
            let sid = session_id.0;
            // Register in ECS world so it shows up in session list
            {
                let mut world = state.ecs.write().await;
                let now_epoch = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                world.spawn_session(SessionComponent {
                    id: sid,
                    path: body.working_dir.clone(),
                    status: SessionStatus::Active,
                    model: None,
                    started_at: now_epoch,
                    last_activity_at: now_epoch,
                    cost: None,
                });
            }
            // Register path → managed session mapping so the file watcher
            // can link JSONL sessions (created by the CLI) to this managed session.
            // Key is the encoded form (e.g., `-tmp-test-session`) to match JSONL dir names.
            {
                let mut msp = state.managed_session_paths.write().await;
                msp.insert(encode_project_dir(&body.working_dir), sid);
            }
            // Register cli_type immediately so the API exposes the correct
            // badge (CLD/CDX/GEM) before the file watcher discovers the JSONL.
            {
                use noaide_server::discovery::scanner::CliType;
                let ct = match cli_type {
                    "codex" => CliType::Codex,
                    "gemini" => CliType::Gemini,
                    _ => CliType::Claude,
                };
                let mut types = state.session_cli_types.write().await;
                types.insert(sid, ct);
            }
            // For Codex/Gemini: also register by CLI type as fallback
            // (their JSONL paths don't encode the project directory)
            if cli_type != "claude" {
                let mut pending = state.managed_pending_by_cli.write().await;
                pending.insert(cli_type.to_string(), sid);
            }
            info!(session = %sid, working_dir = %body.working_dir, "managed session created via API");
            (
                axum::http::StatusCode::OK,
                axum::Json(serde_json::json!({
                    "ok": true,
                    "sessionId": sid.to_string(),
                })),
            )
        }
        Err(e) => {
            warn!(error = %e, working_dir = %body.working_dir, "failed to create managed session");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({
                    "error": format!("failed to spawn session: {e}")
                })),
            )
        }
    }
}

// ── Send Input to Managed Session Handler ────────────────────────────────────

#[derive(serde::Deserialize)]
struct SendInputRequest {
    text: String,
}

/// Send raw text input to a managed session's PTY stdin.
///
/// This directly writes to the PTY — useful for sending commands,
/// answering prompts, or sending Ctrl sequences to the running CLI.
async fn api_send_input(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<SendInputRequest>,
) -> impl axum::response::IntoResponse {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "invalid session id"})),
        );
    };

    let mgr = state.session_manager.read().await;
    let session_id = noaide_server::session::SessionId(uuid);
    match mgr.get(&session_id) {
        Some(session) => match session.send_input(&body.text).await {
            Ok(()) => (
                axum::http::StatusCode::OK,
                axum::Json(serde_json::json!({"ok": true})),
            ),
            Err(e) => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": format!("send_input failed: {e}")})),
            ),
        },
        None => (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "managed session not found"})),
        ),
    }
}

// ── Close Managed Session Handler ────────────────────────────────────────────

/// Close a managed session (sends Ctrl-C + Ctrl-D to the PTY).
async fn api_close_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl axum::response::IntoResponse {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "invalid session id"})),
        );
    };

    let mgr = state.session_manager.read().await;
    let session_id = noaide_server::session::SessionId(uuid);
    match mgr.get(&session_id) {
        Some(session) => match session.close().await {
            Ok(()) => {
                info!(session = %uuid, "managed session closed via API");
                (
                    axum::http::StatusCode::OK,
                    axum::Json(serde_json::json!({"ok": true})),
                )
            }
            Err(e) => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": format!("close failed: {e}")})),
            ),
        },
        None => (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "managed session not found"})),
        ),
    }
}

// ── Append Message Handler ──────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct AppendMessageRequest {
    entry: serde_json::Value,
}

/// Append a raw JSONL entry to a session's JSONL file.
///
/// This enables the GUI to inject messages (including images) into the
/// session's append-only log. The file watcher picks up the change and
/// the new message flows through the normal pipeline.
async fn api_append_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<AppendMessageRequest>,
) -> impl axum::response::IntoResponse {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "invalid session id"})),
        );
    };

    let paths = state.session_paths.read().await;
    let Some(jsonl_path) = paths.get(&uuid).cloned() else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "session JSONL path not found"})),
        );
    };
    drop(paths);

    // Serialize entry to a single JSON line
    let mut line = match serde_json::to_string(&body.entry) {
        Ok(s) => s,
        Err(e) => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"error": format!("serialize error: {e}")})),
            );
        }
    };
    line.push('\n');

    // Append to JSONL file
    use tokio::io::AsyncWriteExt;
    let file = tokio::fs::OpenOptions::new()
        .append(true)
        .open(&jsonl_path)
        .await;

    match file {
        Ok(mut f) => match f.write_all(line.as_bytes()).await {
            Ok(()) => {
                tracing::debug!(
                    session = %uuid,
                    path = %jsonl_path.display(),
                    bytes = line.len(),
                    "appended JSONL entry"
                );
                (
                    axum::http::StatusCode::OK,
                    axum::Json(serde_json::json!({"ok": true})),
                )
            }
            Err(e) => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": format!("write failed: {e}")})),
            ),
        },
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": format!("open failed: {e}")})),
        ),
    }
}

// ── Proxy Log → ECS Component Conversion ────────────────────────────────────

/// Sentinel UUID for proxy requests not tied to a specific session.
const GLOBAL_PROXY_SESSION: Uuid = Uuid::nil();

/// Convert a proxy `ApiRequestLog` into an `ApiRequestComponent` for DB persistence.
fn proxy_log_to_component(log: &noaide_server::proxy::ApiRequestLog) -> ApiRequestComponent {
    ApiRequestComponent {
        id: Uuid::parse_str(&log.id).unwrap_or_else(|_| Uuid::new_v4()),
        session_id: log
            .session_id
            .as_ref()
            .and_then(|s| Uuid::parse_str(s).ok())
            .unwrap_or(GLOBAL_PROXY_SESSION),
        method: log.method.clone(),
        url: log.url.clone(),
        request_body: Some(log.request_body.clone()),
        response_body: Some(log.response_body.clone()),
        status_code: Some(log.status_code),
        latency_ms: Some(log.latency_ms as u32),
        timestamp: log.timestamp,
        request_headers: Some(serde_json::to_string(&log.request_headers).unwrap_or_default()),
        response_headers: Some(serde_json::to_string(&log.response_headers).unwrap_or_default()),
        request_size: Some(log.request_size as u64),
        response_size: Some(log.response_size as u64),
    }
}

/// Convert a persisted `ApiRequestComponent` back to an `ApiRequestLog` for the in-memory cache.
fn component_to_proxy_log(c: &ApiRequestComponent) -> noaide_server::proxy::ApiRequestLog {
    noaide_server::proxy::ApiRequestLog {
        id: c.id.to_string(),
        session_id: if c.session_id == GLOBAL_PROXY_SESSION {
            None
        } else {
            Some(c.session_id.to_string())
        },
        method: c.method.clone(),
        url: c.url.clone(),
        request_body: c.request_body.clone().unwrap_or_default(),
        response_body: c.response_body.clone().unwrap_or_default(),
        status_code: c.status_code.unwrap_or(0),
        latency_ms: c.latency_ms.unwrap_or(0) as u64,
        request_headers: c
            .request_headers
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default(),
        response_headers: c
            .response_headers
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default(),
        timestamp: c.timestamp,
        request_size: c.request_size.unwrap_or(0) as usize,
        response_size: c.response_size.unwrap_or(0) as usize,
    }
}

// ── Proxy API Handlers ──────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct ProxyRequestsQuery {
    session_id: Option<String>,
}

/// List captured proxy requests (summary without bodies).
/// Optional `?session_id=...` query parameter filters by session.
async fn api_get_proxy_requests(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<ProxyRequestsQuery>,
) -> axum::Json<serde_json::Value> {
    let cap = state.proxy.captured.read().await;
    let items: Vec<serde_json::Value> = cap
        .iter()
        .filter(|r| match &query.session_id {
            Some(sid) => r.session_id.as_deref() == Some(sid.as_str()),
            None => true,
        })
        .map(|r| {
            // Extract useful preview from request body (model + first message)
            let req_preview = extract_request_preview(&r.request_body);
            let res_preview = truncate_preview(&r.response_body, 120);
            serde_json::json!({
                "id": r.id,
                "sessionId": r.session_id,
                "method": r.method,
                "url": r.url,
                "statusCode": r.status_code,
                "latencyMs": r.latency_ms,
                "requestSize": r.request_size,
                "responseSize": r.response_size,
                "timestamp": r.timestamp,
                "requestPreview": req_preview,
                "responsePreview": res_preview,
            })
        })
        .collect();
    axum::Json(serde_json::json!(items))
}

/// Extract a human-readable preview from an API request body JSON.
/// Shows model name and beginning of the first user message.
fn extract_request_preview(body: &str) -> String {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(body) else {
        return truncate_preview(body, 80);
    };
    let mut parts = Vec::new();
    if let Some(model) = val.get("model").and_then(|m| m.as_str()) {
        parts.push(model.to_string());
    }
    if let Some(msgs) = val.get("messages").and_then(|m| m.as_array())
        && let Some(last) = msgs.last()
    {
        let role = last.get("role").and_then(|r| r.as_str()).unwrap_or("?");
        let content = last.get("content").and_then(|c| c.as_str()).unwrap_or("");
        let truncated = if content.len() > 60 {
            format!("{}...", &content[..60])
        } else {
            content.to_string()
        };
        parts.push(format!("[{role}] {truncated}"));
    }
    if parts.is_empty() {
        truncate_preview(body, 80)
    } else {
        parts.join(" | ")
    }
}

/// Truncate a string to max_len chars, appending "..." if truncated.
fn truncate_preview(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        // Find a valid UTF-8 boundary at or before max_len
        let boundary = s
            .char_indices()
            .take_while(|(i, _)| *i < max_len)
            .last()
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(0);
        format!("{}...", &s[..boundary])
    }
}

/// Get a single captured proxy request with full details (bodies + headers).
async fn api_get_proxy_request_detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl axum::response::IntoResponse {
    let cap = state.proxy.captured.read().await;
    match cap.iter().find(|r| r.id == id) {
        Some(r) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({
                "id": r.id,
                "sessionId": r.session_id,
                "method": r.method,
                "url": r.url,
                "statusCode": r.status_code,
                "latencyMs": r.latency_ms,
                "requestSize": r.request_size,
                "responseSize": r.response_size,
                "timestamp": r.timestamp,
                "requestBody": r.request_body,
                "responseBody": r.response_body,
                "requestHeaders": r.request_headers,
                "responseHeaders": r.response_headers,
            })),
        ),
        None => (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "not found"})),
        ),
    }
}

/// Clear all captured proxy requests.
async fn api_clear_proxy_requests(State(state): State<AppState>) -> axum::Json<serde_json::Value> {
    state.proxy.captured.write().await.clear();
    axum::Json(serde_json::json!({"ok": true}))
}

// ── Intercept API Handlers ──────────────────────────────────────────────────

/// Get intercept status for a session.
async fn api_get_intercept_status(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> axum::Json<serde_json::Value> {
    let modes = state.proxy.intercept_modes.read().await;
    let mode = modes
        .get(&session_id)
        .copied()
        .unwrap_or(noaide_server::proxy::InterceptMode::Auto);
    drop(modes);

    let pending_count = state
        .proxy
        .pending_intercepts
        .read()
        .await
        .values()
        .filter(|p| p.session_id.as_deref() == Some(&session_id))
        .count();

    let pending_response_count = state
        .proxy
        .pending_response_intercepts
        .read()
        .await
        .values()
        .filter(|p| p.session_id.as_deref() == Some(&session_id))
        .count();

    axum::Json(serde_json::json!({
        "mode": mode,
        "pendingCount": pending_count,
        "pendingResponseCount": pending_response_count,
    }))
}

#[derive(serde::Deserialize)]
struct SetInterceptModeRequest {
    mode: noaide_server::proxy::InterceptMode,
}

/// Set intercept mode for a session. When switching to Auto, all pending
/// requests for this session are automatically forwarded.
async fn api_set_intercept_mode(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    axum::Json(body): axum::Json<SetInterceptModeRequest>,
) -> axum::Json<serde_json::Value> {
    state
        .proxy
        .intercept_modes
        .write()
        .await
        .insert(session_id.clone(), body.mode);

    // Auto-forward all pending requests when switching to Auto
    if body.mode == noaide_server::proxy::InterceptMode::Auto {
        let mut pending = state.proxy.pending_intercepts.write().await;
        let session_ids: Vec<String> = pending
            .iter()
            .filter(|(_, p)| p.session_id.as_deref() == Some(&session_id))
            .map(|(id, _)| id.clone())
            .collect();

        let mut forwarded = 0;
        for id in session_ids {
            if let Some(p) = pending.remove(&id) {
                let _ = p
                    .decision_tx
                    .send(noaide_server::proxy::InterceptDecision::Forward {
                        modified_body: None,
                        modified_headers: None,
                    });
                forwarded += 1;
            }
        }

        // Also auto-forward all pending response intercepts for this session
        let mut pending_resp = state.proxy.pending_response_intercepts.write().await;
        let resp_ids: Vec<String> = pending_resp
            .iter()
            .filter(|(_, p)| p.session_id.as_deref() == Some(&session_id))
            .map(|(id, _)| id.clone())
            .collect();

        let mut forwarded_responses = 0;
        for id in resp_ids {
            if let Some(p) = pending_resp.remove(&id) {
                let _ = p
                    .decision_tx
                    .send(noaide_server::proxy::InterceptDecision::Forward {
                        modified_body: None,
                        modified_headers: None,
                    });
                forwarded_responses += 1;
            }
        }

        info!(
            session = %session_id,
            forwarded_requests = forwarded,
            forwarded_responses,
            "switched to auto mode, forwarded all pending"
        );
    }

    axum::Json(serde_json::json!({
        "ok": true,
        "mode": body.mode,
    }))
}

/// List pending intercepted requests for a session.
async fn api_get_pending_intercepts(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> axum::Json<serde_json::Value> {
    let pending = state.proxy.pending_intercepts.read().await;
    let items: Vec<serde_json::Value> = pending
        .values()
        .filter(|p| p.session_id.as_deref() == Some(&session_id))
        .map(|p| {
            // Redact request body for display
            let body_preview =
                noaide_server::proxy::mitm::redact(&String::from_utf8_lossy(&p.request_body));
            // Check if caller (CLI) already disconnected (oneshot receiver dropped)
            let disconnected = p.decision_tx.is_closed();
            serde_json::json!({
                "id": p.id,
                "method": p.method,
                "url": noaide_server::proxy::mitm::redact(&p.url),
                "provider": p.provider.label(),
                "bodyPreview": truncate_preview(&body_preview, 200),
                "headers": p.request_headers.iter()
                    .map(|(k, v)| serde_json::json!({
                        "name": k,
                        "value": noaide_server::proxy::mitm::redact(v),
                    }))
                    .collect::<Vec<_>>(),
                "timestamp": p.timestamp,
                "disconnected": disconnected,
            })
        })
        .collect();
    axum::Json(serde_json::json!(items))
}

/// Return the full (redacted) body for a pending intercept.
async fn api_get_pending_body(
    State(state): State<AppState>,
    Path((session_id, id)): Path<(String, String)>,
) -> impl axum::response::IntoResponse {
    let pending = state.proxy.pending_intercepts.read().await;
    let Some(intercept) = pending.get(&id) else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "intercept not found"})),
        );
    };
    if intercept.session_id.as_deref() != Some(&session_id) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "session mismatch"})),
        );
    }
    let body =
        noaide_server::proxy::mitm::redact(&String::from_utf8_lossy(&intercept.request_body));
    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!({"body": body})),
    )
}

#[derive(serde::Deserialize, Default)]
struct ForwardInterceptRequest {
    #[serde(default)]
    modified_body: Option<String>,
    #[serde(default)]
    modified_headers: Option<Vec<(String, String)>>,
}

/// Forward an intercepted request (optionally with modifications).
async fn api_forward_intercept(
    State(state): State<AppState>,
    Path((session_id, id)): Path<(String, String)>,
    body: Option<axum::Json<ForwardInterceptRequest>>,
) -> impl axum::response::IntoResponse {
    let mut pending = state.proxy.pending_intercepts.write().await;
    let Some(intercept) = pending.remove(&id) else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "intercept not found"})),
        );
    };
    drop(pending);

    // Verify session match
    if intercept.session_id.as_deref() != Some(&session_id) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "session mismatch"})),
        );
    }

    // Check if the caller (CLI client) already disconnected.
    // When the proxy handler future is cancelled (client timeout/disconnect),
    // the oneshot receiver is dropped, making the sender dead.
    if intercept.decision_tx.is_closed() {
        warn!(intercept_id = %id, session = %session_id, "caller already disconnected, cannot forward");
        return (
            axum::http::StatusCode::GONE,
            axum::Json(serde_json::json!({"error": "caller disconnected"})),
        );
    }

    let modifications = body.map(|b| b.0).unwrap_or_default();
    let _ = intercept
        .decision_tx
        .send(noaide_server::proxy::InterceptDecision::Forward {
            modified_body: modifications.modified_body.map(|s| s.into_bytes()),
            modified_headers: modifications.modified_headers,
        });

    info!(intercept_id = %id, session = %session_id, "intercept forwarded via API");

    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!({"ok": true})),
    )
}

/// Drop an intercepted request (returns 499 to the caller).
async fn api_drop_intercept(
    State(state): State<AppState>,
    Path((session_id, id)): Path<(String, String)>,
) -> impl axum::response::IntoResponse {
    let mut pending = state.proxy.pending_intercepts.write().await;
    let Some(intercept) = pending.remove(&id) else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "intercept not found"})),
        );
    };
    drop(pending);

    if intercept.session_id.as_deref() != Some(&session_id) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "session mismatch"})),
        );
    }

    if intercept.decision_tx.is_closed() {
        warn!(intercept_id = %id, session = %session_id, "caller already disconnected, cannot drop");
        return (
            axum::http::StatusCode::GONE,
            axum::Json(serde_json::json!({"error": "caller disconnected"})),
        );
    }

    let _ = intercept
        .decision_tx
        .send(noaide_server::proxy::InterceptDecision::Drop);

    info!(intercept_id = %id, session = %session_id, "intercept dropped via API");

    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!({"ok": true, "action": "dropped"})),
    )
}

// ── Response Intercept API Handlers ─────────────────────────────────────────

/// List pending intercepted responses for a session.
async fn api_get_pending_response_intercepts(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> axum::Json<serde_json::Value> {
    let pending = state.proxy.pending_response_intercepts.read().await;
    let items: Vec<serde_json::Value> = pending
        .values()
        .filter(|p| p.session_id.as_deref() == Some(&session_id))
        .map(|p| {
            let body_preview =
                noaide_server::proxy::mitm::redact(&String::from_utf8_lossy(&p.response_body));
            let disconnected = p.decision_tx.is_closed();
            serde_json::json!({
                "id": p.id,
                "method": p.method,
                "url": noaide_server::proxy::mitm::redact(&p.url),
                "provider": p.provider.label(),
                "statusCode": p.status_code,
                "bodyPreview": truncate_preview(&body_preview, 200),
                "headers": p.response_headers.iter()
                    .map(|(k, v)| serde_json::json!({
                        "name": k,
                        "value": noaide_server::proxy::mitm::redact(v),
                    }))
                    .collect::<Vec<_>>(),
                "timestamp": p.timestamp,
                "disconnected": disconnected,
            })
        })
        .collect();
    axum::Json(serde_json::json!(items))
}

/// Return the full (redacted) body for a pending response intercept.
async fn api_get_pending_response_body(
    State(state): State<AppState>,
    Path((session_id, id)): Path<(String, String)>,
) -> impl axum::response::IntoResponse {
    let pending = state.proxy.pending_response_intercepts.read().await;
    let Some(intercept) = pending.get(&id) else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "response intercept not found"})),
        );
    };
    if intercept.session_id.as_deref() != Some(&session_id) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "session mismatch"})),
        );
    }
    let body =
        noaide_server::proxy::mitm::redact(&String::from_utf8_lossy(&intercept.response_body));
    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!({"body": body})),
    )
}

/// Forward an intercepted response (optionally with modified body).
async fn api_forward_response_intercept(
    State(state): State<AppState>,
    Path((session_id, id)): Path<(String, String)>,
    body: Option<axum::Json<ForwardInterceptRequest>>,
) -> impl axum::response::IntoResponse {
    let mut pending = state.proxy.pending_response_intercepts.write().await;
    let Some(intercept) = pending.remove(&id) else {
        return (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "response intercept not found"})),
        );
    };
    drop(pending);

    if intercept.session_id.as_deref() != Some(&session_id) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "session mismatch"})),
        );
    }

    if intercept.decision_tx.is_closed() {
        warn!(intercept_id = %id, session = %session_id, "response caller already disconnected");
        return (
            axum::http::StatusCode::GONE,
            axum::Json(serde_json::json!({"error": "caller disconnected"})),
        );
    }

    let modifications = body.map(|b| b.0).unwrap_or_default();
    let _ = intercept
        .decision_tx
        .send(noaide_server::proxy::InterceptDecision::Forward {
            modified_body: modifications.modified_body.map(|s| s.into_bytes()),
            modified_headers: modifications.modified_headers,
        });

    info!(intercept_id = %id, session = %session_id, "response intercept forwarded via API");

    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!({"ok": true})),
    )
}

// ── Git API Endpoints ────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct GitSessionQuery {
    session_id: Option<String>,
}

#[derive(serde::Deserialize)]
struct GitLogQuery {
    session_id: Option<String>,
    limit: Option<usize>,
}

#[derive(serde::Deserialize)]
struct GitBlameQuery {
    session_id: Option<String>,
    file: String,
}

#[derive(serde::Deserialize)]
struct GitCheckoutBody {
    session_id: Option<String>,
    branch: String,
}

#[derive(serde::Deserialize)]
struct GitStageBody {
    session_id: Option<String>,
    paths: Vec<String>,
}

#[derive(serde::Deserialize)]
struct GitCommitBody {
    session_id: Option<String>,
    message: String,
}

/// Resolve the git repo path from a session ID (via JSONL path → project dir).
/// Falls back to the noaide project root if no session is specified.
async fn resolve_git_repo(state: &AppState, session_id: Option<&str>) -> Option<PathBuf> {
    if let Some(sid) = session_id {
        if let Ok(uuid) = Uuid::parse_str(sid) {
            let paths = state.session_paths.read().await;
            if let Some(jsonl_path) = paths.get(&uuid).cloned() {
                drop(paths);
                return resolve_session_cwd(&jsonl_path);
            }
            // Try reverse alias for managed sessions
            let world = state.ecs.read().await;
            if let Some(jsonl_id) = world.reverse_alias(uuid) {
                if let Some(jsonl_path) = state.session_paths.read().await.get(&jsonl_id).cloned() {
                    return resolve_session_cwd(&jsonl_path);
                }
            }
        }
    }
    // Fallback: use noaide's own project directory
    let cwd = std::env::current_dir().ok()?;
    if cwd.join(".git").is_dir() {
        Some(cwd)
    } else {
        None
    }
}

async fn api_git_status(
    State(state): State<AppState>,
    Query(query): Query<GitSessionQuery>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, query.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repository found for session"})),
            );
        }
    };
    match noaide_server::git::status(&repo_path) {
        Ok(files) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!(files)),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

async fn api_git_branches(
    State(state): State<AppState>,
    Query(query): Query<GitSessionQuery>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, query.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repository found for session"})),
            );
        }
    };
    match noaide_server::git::branches(&repo_path) {
        Ok(branches) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!(branches)),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

async fn api_git_log(
    State(state): State<AppState>,
    Query(query): Query<GitLogQuery>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, query.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repository found for session"})),
            );
        }
    };
    let limit = query.limit.unwrap_or(50);
    match noaide_server::git::log(&repo_path, limit) {
        Ok(commits) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!(commits)),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

async fn api_git_blame(
    State(state): State<AppState>,
    Query(query): Query<GitBlameQuery>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, query.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repository found for session"})),
            );
        }
    };
    match noaide_server::git::blame_file(&repo_path, &query.file) {
        Ok(lines) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!(lines)),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

async fn api_git_checkout(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<GitCheckoutBody>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, body.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repository found for session"})),
            );
        }
    };
    match noaide_server::git::checkout(&repo_path, &body.branch) {
        Ok(()) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({"ok": true})),
        ),
        Err(e) => (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

async fn api_git_stage(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<GitStageBody>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, body.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repository found for session"})),
            );
        }
    };
    let path_refs: Vec<&str> = body.paths.iter().map(|s| s.as_str()).collect();
    match noaide_server::git::stage(&repo_path, &path_refs) {
        Ok(()) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({"ok": true})),
        ),
        Err(e) => (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

async fn api_git_commit(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<GitCommitBody>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, body.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repository found for session"})),
            );
        }
    };
    if body.message.trim().is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "commit message cannot be empty"})),
        );
    }
    match noaide_server::git::commit(&repo_path, &body.message) {
        Ok(hash) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({"ok": true, "hash": hash})),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

// ── Teams API — Discover team configs and build topology graphs ────────────

/// GET /api/teams — List all discovered teams from ~/.claude/teams/
async fn api_get_teams() -> impl axum::response::IntoResponse {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
    let claude_dir = PathBuf::from(home).join(".claude");
    let (discovery, _rx) = TeamDiscovery::new(&claude_dir);
    let teams = discovery.scan().await;

    let result: Vec<serde_json::Value> = teams
        .iter()
        .map(|t| {
            serde_json::json!({
                "team_name": t.config.name,
                "description": t.config.description,
                "members": t.config.members,
                "created_at": t.config.created_at,
                "has_tasks": t.task_dir.is_some(),
            })
        })
        .collect();

    axum::Json(result)
}

/// GET /api/teams/:name/topology — Get topology graph for a specific team
async fn api_get_team_topology(Path(team_name): Path<String>) -> impl axum::response::IntoResponse {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
    let claude_dir = PathBuf::from(home).join(".claude");
    let (discovery, _rx) = TeamDiscovery::new(&claude_dir);
    let teams = discovery.scan().await;

    let team = teams.iter().find(|t| t.config.name == team_name);
    match team {
        Some(t) => {
            let mut builder = TopologyBuilder::new(&t.config.name);
            builder.add_members(&t.config.members);
            let topology = builder.build();
            (
                axum::http::StatusCode::OK,
                axum::Json(serde_json::to_value(&topology).unwrap_or_default()),
            )
        }
        None => (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": format!("team '{}' not found", team_name)})),
        ),
    }
}

// ── SSE Endpoint — Realtime event stream (HTTP fallback for WebTransport) ────

#[derive(serde::Deserialize)]
struct SseQuery {
    /// Optional session ID filter. Only events matching this session are sent.
    session_id: Option<String>,
    /// Comma-separated topic filter (default: all topics).
    topics: Option<String>,
}

/// SSE endpoint that streams events from the event bus to the browser.
///
/// This is the HTTP fallback for WebTransport — same events, same bus,
/// just delivered via Server-Sent Events over HTTP/1.1.
///
/// Usage: GET /api/events?session_id=UUID&topics=session/messages,api/requests
async fn api_sse_events(
    State(state): State<AppState>,
    Query(query): Query<SseQuery>,
) -> Sse<impl futures_util::Stream<Item = Result<SseEvent, std::convert::Infallible>>> {
    let session_filter = query.session_id.and_then(|s| Uuid::parse_str(&s).ok());

    // Determine which topics to subscribe to
    let requested_topics: Vec<&'static str> = match query.topics {
        Some(ref t) => {
            let mut topics = Vec::new();
            for part in t.split(',') {
                match part.trim() {
                    "session/messages" => topics.push(bus::SESSION_MESSAGES),
                    "files/changes" => topics.push(bus::FILE_CHANGES),
                    "tasks/updates" => topics.push(bus::TASK_UPDATES),
                    "api/requests" => topics.push(bus::API_REQUESTS),
                    "system/events" => topics.push(bus::SYSTEM_EVENTS),
                    "agents/metrics" => topics.push(bus::AGENT_METRICS),
                    _ => {}
                }
            }
            if topics.is_empty() {
                vec![bus::SESSION_MESSAGES]
            } else {
                topics
            }
        }
        None => vec![bus::SESSION_MESSAGES, bus::API_REQUESTS, bus::SYSTEM_EVENTS],
    };

    // Create a merged stream from all subscribed topics
    let (tx, rx) = tokio::sync::mpsc::channel::<(String, bus::EventEnvelope)>(256);

    for topic in requested_topics {
        let tx = tx.clone();
        let bus = state.event_bus.clone();
        let topic_owned = topic.to_string();
        tokio::spawn(async move {
            match bus.subscribe(topic).await {
                Ok(mut bus_rx) => loop {
                    match bus_rx.recv().await {
                        Ok(envelope) => {
                            if tx.send((topic_owned.clone(), envelope)).await.is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!(
                                topic = %topic_owned,
                                lagged = n,
                                "SSE subscriber lagged"
                            );
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                },
                Err(e) => {
                    tracing::warn!(topic = %topic_owned, error = %e, "SSE: failed to subscribe");
                }
            }
        });
    }
    // Drop the original sender so the stream ends when all spawned tasks end
    drop(tx);

    let sse_stream =
        tokio_stream::wrappers::ReceiverStream::new(rx).filter_map(move |(topic, envelope)| {
            // Filter by session_id if requested
            if let Some(filter_sid) = session_filter {
                match envelope.session_id {
                    Some(event_sid) if event_sid != filter_sid => return None,
                    None if topic == bus::SESSION_MESSAGES => return None,
                    _ => {} // matching session_id or system event without session_id
                }
            }

            let data = serde_json::json!({
                "topic": topic,
                "event_id": envelope.event_id.to_string(),
                "source": format!("{:?}", envelope.source),
                "session_id": envelope.session_id.map(|s| s.to_string()),
                "sequence": envelope.sequence,
                "logical_ts": envelope.logical_ts,
                "wall_ts": envelope.wall_ts,
                "payload": String::from_utf8_lossy(&envelope.payload),
            });

            Some(Ok(SseEvent::default().event(&topic).data(data.to_string())))
        });

    Sse::new(sse_stream).keep_alive(KeepAlive::default())
}
