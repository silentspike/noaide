use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, StatusCode};
use axum::routing::{delete, get, patch, post};
use tokio::sync::RwLock;
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
use noaide_server::teams::{AgentStatus, TeamDiscovery, TopologyBuilder, load_inboxes, load_tasks};
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
    /// Event bus for WebTransport subscriptions (ADR-8).
    event_bus: Arc<dyn bus::EventBus>,
    /// Whether whisper voice transcription sidecar is enabled.
    whisper_enabled: bool,
    /// Port where the whisper sidecar listens.
    whisper_port: u16,
    /// Maps session UUID → watched project root path (WP-10: File Browser).
    /// Used by the watcher to publish FILE_CHANGES events for project files.
    project_watches: Arc<RwLock<HashMap<Uuid, PathBuf>>>,
    /// Base directory for TOGAF plans (/work/plan/).
    plan_base_dir: Arc<PathBuf>,
    /// Maps session UUID → plan name (for auto-selecting plan in Plan tab).
    session_plan_mapping: Arc<RwLock<HashMap<Uuid, String>>>,
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
    let project_watches: Arc<RwLock<HashMap<Uuid, PathBuf>>> =
        Arc::new(RwLock::new(HashMap::new()));

    // TOGAF Plan base directory (contains {name}/plan.json files)
    let plan_base_dir = Arc::new(PathBuf::from(
        std::env::var("NOAIDE_PLAN_DIR").unwrap_or_else(|_| "/work/plan".to_string()),
    ));
    info!(dir = %plan_base_dir.display(), "TOGAF plan base directory");

    // Restore managed session→plan mappings from previous run (if available)
    let session_plan_mapping: Arc<RwLock<HashMap<Uuid, String>>> =
        Arc::new(RwLock::new(HashMap::new()));
    // Persistent storage: /data/noaide/ for session state (survives restarts)
    let persist_dir = std::path::Path::new("/data/noaide");
    if !persist_dir.exists() {
        let _ = tokio::fs::create_dir_all(persist_dir).await;
    }
    if let Ok(data) = tokio::fs::read_to_string("/data/noaide/managed-sessions.json").await {
        if let Ok(entries) = serde_json::from_str::<Vec<serde_json::Value>>(&data) {
            let mut mapping = session_plan_mapping.write().await;
            for entry in &entries {
                if let (Some(sid), Some(plan)) = (
                    entry["session_id"]
                        .as_str()
                        .and_then(|s| Uuid::parse_str(s).ok()),
                    entry["plan"].as_str(),
                ) {
                    if !plan.is_empty() {
                        mapping.insert(sid, plan.to_string());
                    }
                }
            }
            info!(
                restored = mapping.len(),
                "restored session→plan mappings from previous run"
            );
            drop(mapping);
        }
    }

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
        whisper_enabled: std::env::var("ENABLE_WHISPER")
            .map(|v| v != "false")
            .unwrap_or(true),
        whisper_port: std::env::var("WHISPER_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8082),
        project_watches: project_watches.clone(),
        plan_base_dir: plan_base_dir.clone(),
        session_plan_mapping: session_plan_mapping.clone(),
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
        .route("/api/sessions/{id}/images", post(api_queue_images))
        .route("/api/sessions/{id}/send", post(api_send_message))
        .route("/api/sessions/{id}/input", post(api_send_input))
        .route("/api/sessions/{id}/stats", get(api_get_session_stats))
        .route("/api/sessions/{id}/close", post(api_close_session))
        .route("/api/sessions/{id}", delete(api_delete_session))
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
        .route(
            "/api/proxy/network-rules/{session_id}",
            get(api_get_network_rules).put(api_set_network_rules),
        )
        .route(
            "/api/proxy/network-rules/{session_id}/rules",
            post(api_add_network_rule),
        )
        .route(
            "/api/proxy/network-rules/{session_id}/rules/{rule_id}",
            delete(api_delete_network_rule),
        )
        .route(
            "/api/proxy/network-rules/{session_id}/quick-block",
            post(api_quick_block_domain),
        )
        .route("/api/plans", get(api_list_plans))
        .route(
            "/api/plans/for-session/{session_id}",
            get(api_plan_for_session),
        )
        .route("/api/plans/{name}/plan.json", get(api_get_plan_json))
        .route("/api/plans/{name}/edits", post(api_post_plan_edits))
        .route("/api/git/status", get(api_git_status))
        .route("/api/git/branches", get(api_git_branches))
        .route("/api/git/log", get(api_git_log))
        .route("/api/git/blame", get(api_git_blame))
        .route("/api/git/checkout", post(api_git_checkout))
        .route("/api/git/stage", post(api_git_stage))
        .route("/api/git/stage-hunk", post(api_git_stage_hunk))
        .route("/api/git/unstage", post(api_git_unstage))
        .route("/api/git/commit", post(api_git_commit))
        .route("/api/git/diff-hunks", get(api_git_diff_hunks))
        .route("/api/git/prs", get(api_git_pr_list))
        .route("/api/git/prs", post(api_git_pr_create))
        .route("/api/browse", get(api_browse_directories))
        .route("/api/sessions/{id}/files", get(api_list_session_files))
        .route(
            "/api/sessions/{id}/file",
            get(api_get_session_file).put(api_save_session_file),
        )
        .route("/api/teams", get(api_get_teams))
        .route("/api/teams/{name}/topology", get(api_get_team_topology))
        .route("/api/teams/{name}/tasks", get(api_get_team_tasks))
        // WebTransport (ADR-8) replaces SSE — events delivered via QUIC on port 4433
        .route("/api/ca.pem", get(api_get_ca_cert))
        .route("/api/ca.crt", get(api_get_ca_cert_crt))
        .route("/api/server-info", get(api_server_info))
        .route("/api/ws/transcribe", get(api_ws_transcribe))
        .route("/api/files", get(api_serve_file))
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

    // ── Whisper Sidecar (voice transcription) ───────────────────────────────
    let enable_whisper = std::env::var("ENABLE_WHISPER")
        .map(|v| v != "false")
        .unwrap_or(true);
    if enable_whisper {
        let whisper_port: u16 = std::env::var("WHISPER_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8082);
        let venv_python =
            std::env::var("WHISPER_PYTHON").unwrap_or_else(|_| "/venv/bin/python".into());
        let script_path = std::env::current_dir()
            .unwrap_or_default()
            .join("server/whisper/server.py");
        if script_path.exists() {
            tokio::spawn(async move {
                loop {
                    info!(port = whisper_port, "spawning whisper sidecar");
                    let result = tokio::process::Command::new(&venv_python)
                        .arg(&script_path)
                        .env("WHISPER_PORT", whisper_port.to_string())
                        .kill_on_drop(true)
                        .spawn();
                    match result {
                        Ok(mut child) => match child.wait().await {
                            Ok(status) => {
                                warn!(code = ?status.code(), "whisper sidecar exited");
                            }
                            Err(e) => {
                                warn!(error = %e, "whisper sidecar wait error");
                            }
                        },
                        Err(e) => {
                            warn!(error = %e, python = %venv_python, "failed to spawn whisper sidecar");
                        }
                    }
                    info!("restarting whisper sidecar in 3s");
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                }
            });
        } else {
            warn!(path = %script_path.display(), "whisper sidecar script not found, voice disabled");
        }
    }

    info!("servers ready — starting background session discovery");

    // ── File Watcher ────────────────────────────────────────────────────────

    let enable_ebpf = std::env::var("ENABLE_EBPF")
        .map(|v| v != "false")
        .unwrap_or(true);
    let watcher: Arc<dyn noaide_server::watcher::Watcher> =
        Arc::from(noaide_server::watcher::create_watcher(enable_ebpf)?);
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

    // Phase 2b: Register project directory watches for FILE_CHANGES (WP-10)
    // This watches the actual project roots (e.g. /work/noaide/) so the watcher
    // detects non-JSONL file changes and publishes them via the event bus.
    {
        let mut watches = project_watches.write().await;
        let mut watched_roots: std::collections::HashSet<PathBuf> =
            std::collections::HashSet::new();
        for session_info in &all_sessions {
            if let Some(ref project_path) = session_info.project_path {
                let session_id = match Uuid::parse_str(&session_info.id) {
                    Ok(id) => id,
                    Err(_) => continue,
                };
                let root = project_path.clone();
                if !watched_roots.contains(&root) {
                    if root.exists() {
                        if let Err(e) = watcher.watch(&root).await {
                            tracing::warn!(
                                root = %root.display(),
                                error = %e,
                                "failed to watch project root"
                            );
                        } else {
                            tracing::info!(
                                root = %root.display(),
                                session = %session_id,
                                "watching project root for file changes"
                            );
                        }
                        watched_roots.insert(root.clone());
                    }
                }
                watches.entry(session_id).or_insert(root);
            }
        }
        info!(
            project_watches = watches.len(),
            watched_roots = watched_roots.len(),
            "project directory watches registered"
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
    let project_watches_handle = project_watches.clone();
    let watcher_handle = watcher.clone();
    let mut events_rx = watcher.events();
    // Debounce map for project file changes: skip events <50ms apart for the same path.
    // This prevents event flooding when editors save (temp-write + rename pattern).
    let file_change_debounce: Arc<tokio::sync::Mutex<HashMap<PathBuf, std::time::Instant>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(event) => {
                    let path = &event.path;
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if ext == "jsonl" || ext == "json" {
                        tracing::info!(
                            path = %path.display(),
                            kind = ?event.kind,
                            "watcher event"
                        );
                    }
                    // (Plan watcher removed — plans are served via nginx from /work/plan/)

                    if ext != "jsonl" && ext != "json" {
                        // ── Project file change → FILE_CHANGES bus (WP-10) ────────
                        let watches = project_watches_handle.read().await;
                        let match_result = watches
                            .iter()
                            .find(|(_sid, root)| path.starts_with(root.as_path()))
                            .map(|(sid, root)| (*sid, root.clone()));
                        drop(watches);

                        if let Some((session_id, project_root)) = match_result {
                            // Skip hard-excluded paths
                            if noaide_server::files::listing::should_ignore_path(
                                path,
                                &project_root,
                            ) {
                                continue;
                            }

                            // Debounce: skip events <50ms after last event for same path
                            let now = std::time::Instant::now();
                            {
                                let mut debounce = file_change_debounce.lock().await;
                                if let Some(last) = debounce.get(path) {
                                    if now.duration_since(*last)
                                        < std::time::Duration::from_millis(50)
                                    {
                                        continue;
                                    }
                                }
                                debounce.insert(path.clone(), now);
                                // Evict old entries (>10s) to prevent unbounded growth
                                debounce.retain(|_, ts| {
                                    now.duration_since(*ts) < std::time::Duration::from_secs(10)
                                });
                            }

                            let relative = path
                                .strip_prefix(&project_root)
                                .map(|p| p.to_string_lossy().to_string())
                                .unwrap_or_default();

                            let kind_str = match event.kind {
                                FileEventKind::Created => "created",
                                FileEventKind::Modified => "modified",
                                FileEventKind::Deleted => "deleted",
                            };

                            // Content push for files <100KB (saves HTTP round-trip via WebTransport)
                            let (content, file_size) = if event.kind != FileEventKind::Deleted {
                                match tokio::fs::metadata(path).await {
                                    Ok(meta) if meta.len() < 100_000 => {
                                        let c = tokio::fs::read_to_string(path).await.ok();
                                        (c, Some(meta.len()))
                                    }
                                    Ok(meta) => (None, Some(meta.len())),
                                    Err(_) => (None, None),
                                }
                            } else {
                                (None, None)
                            };

                            let wall_ts = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);

                            // MessagePack payload (Hot Path — NOT JSON!)
                            let payload = noaide_server::files::FileChangePayload {
                                path: relative.clone(),
                                kind: kind_str.to_string(),
                                pid: event.pid,
                                session_id: session_id.to_string(),
                                project_root: project_root.display().to_string(),
                                timestamp: wall_ts,
                                content,
                                size: file_size,
                            };
                            let payload_bytes =
                                rmp_serde::to_vec_named(&payload).unwrap_or_default();

                            let envelope = EventEnvelope::new(
                                EventSource::Watcher,
                                0,
                                0,
                                Some(session_id),
                                payload_bytes,
                            );

                            // ECS update: upsert or despawn file entity
                            {
                                let mut world = ecs_handle.write().await;
                                match event.kind {
                                    FileEventKind::Created | FileEventKind::Modified => {
                                        world.upsert_file(
                                            session_id,
                                            &relative,
                                            file_size.unwrap_or(0),
                                            wall_ts,
                                        );
                                    }
                                    FileEventKind::Deleted => {
                                        world.despawn_file_by_path(session_id, &relative);
                                    }
                                }
                            }

                            // eBPF PID → Claude-Editing detection (ADR-5 KERN-Feature)
                            if let Some(pid) = event.pid {
                                if is_claude_pid(&ecs_handle, pid).await {
                                    let mut world = ecs_handle.write().await;
                                    world.set_claude_editing(session_id, &relative, pid);
                                }
                            }

                            let _ = bus_handle.publish(bus::FILE_CHANGES, envelope).await;
                            tracing::debug!(
                                path = %relative,
                                kind = kind_str,
                                session = %session_id,
                                "file change published to bus"
                            );
                        }
                        continue;
                    }

                    match event.kind {
                        FileEventKind::Created | FileEventKind::Modified => {
                            // Extract session UUID from filename — format varies by CLI type
                            let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                            let session_id = if ext == "json" {
                                // Gemini: session-{timestamp}-{uuid}.json
                                discovery::extract_gemini_uuid(filename)
                                    .and_then(|s| Uuid::parse_str(&s).ok())
                            } else if filename.starts_with("rollout-") {
                                // Codex: rollout-{timestamp}-{uuid}.jsonl
                                discovery::extract_codex_uuid(filename)
                                    .and_then(|s| Uuid::parse_str(&s).ok())
                            } else {
                                // Claude: {uuid}.jsonl
                                path.file_stem()
                                    .and_then(|s| s.to_str())
                                    .and_then(|s| Uuid::parse_str(s).ok())
                            };

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

                            // WP-10: Register project directory watch for FILE_CHANGES
                            {
                                if let Some(project_root) = resolve_session_cwd(path) {
                                    let mut watches = project_watches_handle.write().await;
                                    if !watches.values().any(|r| *r == project_root) {
                                        // Also watch the project root in the file watcher
                                        if let Err(e) = watcher_handle.watch(&project_root).await {
                                            tracing::warn!(
                                                root = %project_root.display(),
                                                error = %e,
                                                "failed to watch new project root"
                                            );
                                        } else {
                                            info!(
                                                session = %effective_sid,
                                                root = %project_root.display(),
                                                "registered project watch for file changes"
                                            );
                                        }
                                        watches.insert(effective_sid, project_root);
                                    }
                                }
                            }

                            // Parse new messages — dispatch to the right parser by CLI type.
                            // Claude: incremental byte-offset JSONL parsing.
                            // Gemini/Codex: full re-parse, diff by message count.
                            let cli_type = cli_type_from_path(path);
                            let parse_result: Result<Vec<parser::ClaudeMessage>, anyhow::Error> =
                                match cli_type {
                                    noaide_server::discovery::scanner::CliType::Claude => {
                                        // Incremental JSONL parse (byte-offset based)
                                        let from_offset = {
                                            offsets_watch
                                                .lock()
                                                .await
                                                .get(path)
                                                .copied()
                                                .unwrap_or(0)
                                        };
                                        match parser::parse_incremental(path, from_offset).await {
                                            Ok((messages, new_offset)) => {
                                                offsets_watch
                                                    .lock()
                                                    .await
                                                    .insert(path.clone(), new_offset);
                                                Ok(messages)
                                            }
                                            Err(e) => Err(e),
                                        }
                                    }
                                    noaide_server::discovery::scanner::CliType::Gemini => {
                                        // Full re-parse JSON, diff by message count
                                        let prev_count = {
                                            offsets_watch
                                                .lock()
                                                .await
                                                .get(path)
                                                .copied()
                                                .unwrap_or(0)
                                                as usize
                                        };
                                        match parser::parse_gemini_file(path).await {
                                            Ok(all_messages) => {
                                                let total = all_messages.len();
                                                offsets_watch
                                                    .lock()
                                                    .await
                                                    .insert(path.clone(), total as u64);
                                                if total > prev_count {
                                                    Ok(all_messages
                                                        .into_iter()
                                                        .skip(prev_count)
                                                        .collect())
                                                } else {
                                                    Ok(Vec::new())
                                                }
                                            }
                                            Err(e) => Err(e),
                                        }
                                    }
                                    noaide_server::discovery::scanner::CliType::Codex => {
                                        // Full re-parse JSONL (different schema), diff by count
                                        let prev_count = {
                                            offsets_watch
                                                .lock()
                                                .await
                                                .get(path)
                                                .copied()
                                                .unwrap_or(0)
                                                as usize
                                        };
                                        match parser::parse_codex_file(path).await {
                                            Ok(all_messages) => {
                                                let total = all_messages.len();
                                                offsets_watch
                                                    .lock()
                                                    .await
                                                    .insert(path.clone(), total as u64);
                                                if total > prev_count {
                                                    Ok(all_messages
                                                        .into_iter()
                                                        .skip(prev_count)
                                                        .collect())
                                                } else {
                                                    Ok(Vec::new())
                                                }
                                            }
                                            Err(e) => Err(e),
                                        }
                                    }
                                };

                            match parse_result {
                                Ok(messages) if !messages.is_empty() => {
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

                                    // Convert to components, store in ECS cache, and push to bus.
                                    let mut serialized_messages = Vec::new();
                                    {
                                        let mut world = ecs_handle.write().await;
                                        for msg in &messages {
                                            if let Some(component) =
                                                parser::message_to_component(msg, effective_sid)
                                            {
                                                serialized_messages
                                                    .push(component_to_json(&component));
                                                // Store in ECS for cache-first API serving
                                                world.spawn_message(component);
                                            }
                                        }
                                        // Update cache meta with new offset
                                        let file_size = tokio::fs::metadata(path)
                                            .await
                                            .map(|m| m.len())
                                            .unwrap_or(0);
                                        let now_secs = std::time::SystemTime::now()
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .map(|d| d.as_secs() as i64)
                                            .unwrap_or(0);
                                        let total_count =
                                            world.message_count_for_session(effective_sid);
                                        let current_offset = offsets_watch
                                            .lock()
                                            .await
                                            .get(path)
                                            .copied()
                                            .unwrap_or(0);
                                        world.upsert_cache_meta(
                                            noaide_server::ecs::components::CacheMetaComponent {
                                                session_id: effective_sid,
                                                file_offset: current_offset,
                                                file_size,
                                                last_refreshed: now_secs,
                                                message_count: total_count,
                                                is_warm: true,
                                            },
                                        );
                                    }

                                    // Update session status based on last parsed message.
                                    // Active = assistant is streaming (no stop_reason yet).
                                    if let Some(last_msg) = messages.last() {
                                        let is_active = last_msg.role.as_deref()
                                            == Some("assistant")
                                            && last_msg.stop_reason.is_none();
                                        let new_status = if is_active {
                                            SessionStatus::Active
                                        } else {
                                            SessionStatus::Idle
                                        };
                                        let old_status = {
                                            let w = ecs_handle.read().await;
                                            w.query_session_by_id(effective_sid)
                                                .map(|s| s.status)
                                                .unwrap_or(SessionStatus::Idle)
                                        };
                                        ecs_handle
                                            .write()
                                            .await
                                            .update_session_status(effective_sid, new_status);
                                        // Push orbState change via WebTransport (instant, no polling needed)
                                        if old_status != new_status {
                                            let status_str = match new_status {
                                                SessionStatus::Active => "active",
                                                SessionStatus::Idle => "idle",
                                                SessionStatus::Error => "error",
                                                SessionStatus::Archived => "archived",
                                            };
                                            let payload = serde_json::to_vec(&serde_json::json!({
                                                "type": "session_status",
                                                "session_id": effective_sid.to_string(),
                                                "status": status_str,
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
                                                .publish(bus::SESSION_STATUS, envelope)
                                                .await;
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
                                        tracing::info!(
                                            session = %effective_sid,
                                            new_messages = serialized_messages.len(),
                                            cli = cli_type.as_str(),
                                            "parsed new messages — pushed to bus"
                                        );
                                    }
                                }
                                Ok(empty) => {
                                    tracing::info!(
                                        path = %path.display(),
                                        cli = cli_type.as_str(),
                                        result_len = empty.len(),
                                        "parse returned no new messages"
                                    );
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        path = %path.display(),
                                        error = %e,
                                        cli = cli_type.as_str(),
                                        "parse failed"
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
                        // Update last_activity_at from the JSONL tail so the
                        // session list stays sorted correctly even when the
                        // watcher hasn't observed new writes yet.
                        if session_info.last_activity_at > 0 {
                            let mut world = ecs_rescan.write().await;
                            world.update_last_activity_at(
                                effective_sid,
                                session_info.last_activity_at,
                            );
                        }
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
///
/// Because the encoding is lossy (`-` encodes both `/` and literal `-`),
/// the decoded path may not exist. In that case we walk up the path components
/// until we find an existing directory, then search upward for a `.git` root.
fn resolve_session_cwd(jsonl_path: &std::path::Path) -> Option<PathBuf> {
    let project_dir = extract_project_path_from_jsonl(jsonl_path)?;
    let path = PathBuf::from(&project_dir);

    // Find the deepest existing ancestor of the decoded path
    let start = if path.is_dir() {
        path
    } else {
        let mut ancestor = path.as_path();
        loop {
            match ancestor.parent() {
                Some(p) if p != ancestor && p.as_os_str().len() > 1 => {
                    if p.is_dir() {
                        break p.to_path_buf();
                    }
                    ancestor = p;
                }
                _ => return None,
            }
        }
    };

    find_git_root(&start)
}

/// Walk upward from `start` to find the nearest directory containing `.git`.
fn find_git_root(start: &std::path::Path) -> Option<PathBuf> {
    let mut dir = start;
    loop {
        if dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
        match dir.parent() {
            Some(p) if p != dir => dir = p,
            _ => return None,
        }
    }
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
            // Use zero-alloc count instead of cloning all messages
            let ecs_count = world.message_count_for_session(s.id);
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

    // Resolve JSONL path (handle managed session aliases)
    let jsonl_path = {
        let paths = state.session_paths.read().await;
        match paths.get(&uuid).cloned() {
            Some(p) => Some(p),
            None => {
                let world = state.ecs.read().await;
                if let Some(jsonl_id) = world.reverse_alias(uuid) {
                    paths.get(&jsonl_id).cloned()
                } else {
                    None
                }
            }
        }
    };

    // Resolve CLI type for this session
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

    if let Some(ref path) = jsonl_path {
        // Cache-first: ensure warm, then refresh incrementally
        let mut world = state.ecs.write().await;
        match noaide_server::cache::ensure_warm(&mut world, uuid, path, cli_type).await {
            Ok(_) => {
                // Serve from ECS cache — all message types included
                let (messages, total, has_more) = world.query_messages_range(uuid, offset, limit);
                let json: Vec<serde_json::Value> = messages
                    .iter()
                    .map(|m| noaide_server::cache::component_to_api_json(m))
                    .collect();
                return axum::Json(serde_json::json!({
                    "messages": json,
                    "total": total,
                    "offset": offset,
                    "limit": limit,
                    "hasMore": has_more,
                }));
            }
            Err(e) => {
                tracing::warn!(session = %uuid, error = %e, "cache warm failed, falling back to direct parse");
            }
        }
    }

    // Fallback: direct parse (if cache fails or no JSONL path)
    if let Some(ref path) = jsonl_path {
        // For large Claude JSONL files (>10MB), use tail-based parsing
        // to avoid loading 400MB+ into memory just to serve the last 50 messages.
        let file_size = tokio::fs::metadata(path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        let use_tail = cli_type == noaide_server::discovery::scanner::CliType::Claude
            && file_size > 10 * 1024 * 1024;

        if use_tail {
            // Parse only the last 2MB (~1300 messages) — enough for any reasonable limit+offset
            let tail_bytes = (2 * 1024 * 1024u64).min(file_size);
            if let Ok((messages, estimated_total)) = parser::parse_tail(path, tail_bytes).await {
                let total = estimated_total;
                let tail_len = messages.len();
                // Apply offset+limit within the tail window
                let start = tail_len.saturating_sub(offset);
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
                    "hasMore": true, // large files always have more (we only parsed tail)
                }));
            }
        }

        let parse_result = match cli_type {
            noaide_server::discovery::scanner::CliType::Codex => {
                parser::parse_codex_file(path).await
            }
            noaide_server::discovery::scanner::CliType::Gemini => {
                parser::parse_gemini_file(path).await
            }
            noaide_server::discovery::scanner::CliType::Claude => parser::parse_file(path).await,
        };
        if let Ok(messages) = parse_result {
            let total = messages.len();
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
                "hasMore": range_start > 0,
            }));
        }
    }

    // Last resort: serve whatever is in ECS
    let world = state.ecs.read().await;
    let (messages, total, has_more) = world.query_messages_range(uuid, offset, limit);
    let json: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| noaide_server::cache::component_to_api_json(m))
        .collect();
    axum::Json(serde_json::json!({
        "messages": json,
        "total": total,
        "offset": offset,
        "limit": limit,
        "hasMore": has_more,
    }))
}

/// GET /api/sessions/{id}/stats — Session statistics computed from cached messages.
async fn api_get_session_stats(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::Json<serde_json::Value> {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return axum::Json(serde_json::json!({"error": "invalid session id"}));
    };

    // Ensure cache is warm before computing stats
    let cli_type = {
        let types = state.session_cli_types.read().await;
        types.get(&uuid).copied().unwrap_or_default()
    };
    let jsonl_path = {
        let paths = state.session_paths.read().await;
        paths.get(&uuid).cloned()
    };
    if let Some(ref path) = jsonl_path {
        let mut world = state.ecs.write().await;
        let _ = noaide_server::cache::ensure_warm(&mut world, uuid, path, cli_type).await;
    }

    let world = state.ecs.read().await;
    let messages = world.query_messages_by_session(uuid);

    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;
    let mut total_cache_creation: u64 = 0;
    let mut total_cache_read: u64 = 0;
    let mut total_cost: f64 = 0.0;
    let mut model_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut tool_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut user_messages = 0u64;
    let mut assistant_messages = 0u64;
    let mut thinking_messages = 0u64;
    let mut first_ts: Option<i64> = None;
    let mut last_ts: Option<i64> = None;

    for msg in &messages {
        total_input_tokens += msg.input_tokens.unwrap_or(0) as u64;
        total_output_tokens += msg.output_tokens.unwrap_or(0) as u64;
        total_cache_creation += msg.cache_creation_input_tokens.unwrap_or(0) as u64;
        total_cache_read += msg.cache_read_input_tokens.unwrap_or(0) as u64;

        if let Some(model) = &msg.model {
            *model_counts.entry(model.clone()).or_insert(0) += 1;
        }

        match msg.role {
            noaide_server::ecs::components::MessageRole::User => user_messages += 1,
            noaide_server::ecs::components::MessageRole::Assistant => assistant_messages += 1,
            _ => {}
        }
        if msg.message_type == noaide_server::ecs::components::MessageType::Thinking {
            thinking_messages += 1;
        }
        if msg.message_type == noaide_server::ecs::components::MessageType::ToolUse {
            // Extract tool name from content if possible
            if let Some(name) = msg
                .content
                .strip_prefix("[tool_use: ")
                .and_then(|s| s.split(']').next())
            {
                *tool_counts.entry(name.to_string()).or_insert(0) += 1;
            }
        }

        if msg.timestamp > 0 {
            if first_ts.is_none() || msg.timestamp < first_ts.unwrap() {
                first_ts = Some(msg.timestamp);
            }
            if last_ts.is_none() || msg.timestamp > last_ts.unwrap() {
                last_ts = Some(msg.timestamp);
            }
        }
    }

    // Estimate cost from token counts (Claude pricing ~$15/MTok input, ~$75/MTok output for Opus)
    // This is a rough estimate — actual cost comes from API responses
    let session = world.query_session_by_id(uuid);
    if let Some(ref s) = session {
        if let Some(c) = s.cost {
            total_cost = c;
        }
    }

    let duration_secs = match (first_ts, last_ts) {
        (Some(f), Some(l)) => Some(l - f),
        _ => None,
    };

    axum::Json(serde_json::json!({
        "sessionId": uuid.to_string(),
        "messageCount": messages.len(),
        "userMessages": user_messages,
        "assistantMessages": assistant_messages,
        "thinkingMessages": thinking_messages,
        "totalInputTokens": total_input_tokens,
        "totalOutputTokens": total_output_tokens,
        "totalCacheCreationTokens": total_cache_creation,
        "totalCacheReadTokens": total_cache_read,
        "totalCostUsd": total_cost,
        "modelBreakdown": model_counts,
        "toolBreakdown": tool_counts,
        "firstMessageAt": first_ts,
        "lastMessageAt": last_ts,
        "durationSecs": duration_secs,
    }))
}

// ═══════════════════════════════════════════════════════════════
// TOGAF Plan API Endpoints
// Plans live in /work/plan/{name}/ — nginx serves plan.json,
// the server only provides discovery and edit-write-back.
// ═══════════════════════════════════════════════════════════════

/// GET /api/plans — List available plans in the plan base directory.
async fn api_list_plans(State(state): State<AppState>) -> axum::Json<serde_json::Value> {
    let base = &*state.plan_base_dir;
    let mut plans = Vec::new();

    if let Ok(mut entries) = tokio::fs::read_dir(base).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(ft) = entry.file_type().await {
                if ft.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    // Validate name (alphanumeric + dash + underscore only)
                    if name
                        .chars()
                        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
                    {
                        let plan_json = base.join(&name).join("plan.json");
                        let has_plan = tokio::fs::metadata(&plan_json).await.is_ok();
                        let edits_json = base.join(&name).join("plan-edits.json");
                        let has_edits = tokio::fs::metadata(&edits_json).await.is_ok();
                        plans.push(serde_json::json!({
                            "name": name,
                            "has_plan_json": has_plan,
                            "has_edits": has_edits,
                        }));
                    }
                }
            }
        }
    }

    // Sort by name
    plans.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or("")
            .cmp(b["name"].as_str().unwrap_or(""))
    });

    axum::Json(serde_json::json!(plans))
}

/// GET /api/plans/for-session/{session_id} — Return the plan name bound to a session.
async fn api_plan_for_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> axum::Json<serde_json::Value> {
    let uuid = match Uuid::parse_str(&session_id) {
        Ok(u) => u,
        Err(_) => return axum::Json(serde_json::json!({"plan": null})),
    };
    let mapping = state.session_plan_mapping.read().await;
    match mapping.get(&uuid) {
        Some(name) => axum::Json(serde_json::json!({"plan": name})),
        None => axum::Json(serde_json::json!({"plan": null})),
    }
}

/// GET /api/plans/{name}/plan.json — Serve plan.json from /work/plan/{name}/.
async fn api_get_plan_json(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> axum::response::Response {
    use axum::http::{StatusCode, header};
    use axum::response::IntoResponse;

    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return (StatusCode::BAD_REQUEST, "invalid plan name").into_response();
    }

    let path = state.plan_base_dir.join(&name).join("plan.json");
    match tokio::fs::read(&path).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/json"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "plan.json not found").into_response(),
    }
}

/// POST /api/plans/{name}/edits — Write plan-edits.json for the session to pick up.
async fn api_post_plan_edits(
    State(state): State<AppState>,
    Path(name): Path<String>,
    axum::Json(edits): axum::Json<serde_json::Value>,
) -> axum::Json<serde_json::Value> {
    // Validate plan name (prevent path traversal)
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return axum::Json(serde_json::json!({"error": "invalid plan name"}));
    }

    let edits_path = state.plan_base_dir.join(&name).join("plan-edits.json");

    // Ensure directory exists
    if let Some(parent) = edits_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            tracing::warn!(error = %e, "failed to create plan directory");
            return axum::Json(serde_json::json!({"error": "failed to create directory"}));
        }
    }

    match serde_json::to_string_pretty(&edits) {
        Ok(json_str) => {
            if let Err(e) = tokio::fs::write(&edits_path, &json_str).await {
                tracing::warn!(error = %e, plan = %name, "failed to write plan-edits.json");
                return axum::Json(serde_json::json!({"error": "write failed"}));
            }
            info!(plan = %name, path = %edits_path.display(), "wrote plan-edits.json");

            // Publish plan update via WebTransport bus so connected clients
            // receive the change instantly without polling.
            let plan_json_path = state.plan_base_dir.join(&name).join("plan.json");
            if let Ok(plan_data) = tokio::fs::read(&plan_json_path).await {
                let envelope =
                    bus::EventEnvelope::new(bus::EventSource::User, 0, 0, None, plan_data);
                let _ = state.event_bus.publish(bus::PLAN_UPDATES, envelope).await;
                info!(plan = %name, "published plan update via WebTransport");
            }

            axum::Json(serde_json::json!({"ok": true, "plan": name}))
        }
        Err(e) => axum::Json(serde_json::json!({"error": e.to_string()})),
    }
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
            // Send text and CR separately. Ink-based TUIs (Gemini CLI) parse
            // raw PTY input in chunks — if text and \r arrive in the same
            // read() call, Ink treats \r as a newline character in the text
            // field rather than as a Return key press that triggers submit.
            // Splitting the write with a short delay ensures the TUI processes
            // the text first (onChange) and then handles \r as Return (onSubmit).
            // This also works correctly for Claude CLI which handles both forms.
            let send_result = async {
                session.send_input(&body.text).await?;
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                session.send_input("\r").await
            }
            .await;

            match send_result {
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
    /// Skip all tool permission prompts (--dangerously-skip-permissions).
    auto_approve: Option<bool>,
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
    let auto_approve = body.auto_approve.unwrap_or(false);
    match mgr.spawn_managed(&working_dir, Some(base_url), cli_type, auto_approve) {
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
            // Register project watch so the file browser works immediately
            {
                let project_root = PathBuf::from(&body.working_dir);
                let mut watches = state.project_watches.write().await;
                if !watches.values().any(|r| *r == project_root) {
                    // Note: watcher registration happens lazily when JSONL is discovered
                    info!(root = %project_root.display(), session = %sid, "registered project watch for managed session");
                }
                watches.insert(sid, project_root);
            }
            // Auto-detect plan: scan /work/plan/ for a plan whose IMPL-PLAN.md
            // symlinks or matches the session working directory
            {
                let base = &*state.plan_base_dir;
                if let Ok(mut entries) = tokio::fs::read_dir(base).await {
                    while let Ok(Some(entry)) = entries.next_entry().await {
                        if let Ok(ft) = entry.file_type().await {
                            if ft.is_dir() {
                                let name = entry.file_name().to_string_lossy().to_string();
                                let impl_plan = entry.path().join("IMPL-PLAN.md");
                                let plan_json = entry.path().join("plan.json");
                                // Check if this plan dir has an IMPL-PLAN.md and the session
                                // working dir contains an IMPL-PLAN.md too
                                if plan_json.exists() {
                                    let session_impl =
                                        PathBuf::from(&body.working_dir).join("IMPL-PLAN.md");
                                    // Match by: plan dir has symlink to session dir, or
                                    // session dir name matches plan name
                                    let working_dir_name = PathBuf::from(&body.working_dir)
                                        .file_name()
                                        .map(|n| n.to_string_lossy().to_string())
                                        .unwrap_or_default();
                                    if impl_plan.exists()
                                        || name == working_dir_name
                                        || name.contains(&working_dir_name)
                                    {
                                        let mut mapping = state.session_plan_mapping.write().await;
                                        mapping.insert(sid, name.clone());
                                        info!(session = %sid, plan = %name, "auto-bound session to plan");
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // For Codex/Gemini: also register by CLI type as fallback
            // (their JSONL paths don't encode the project directory)
            if cli_type != "claude" {
                let mut pending = state.managed_pending_by_cli.write().await;
                pending.insert(cli_type.to_string(), sid);
            }
            info!(session = %sid, working_dir = %body.working_dir, "managed session created via API");
            // Persist session→plan mapping for server restart recovery
            {
                let mapping = state.session_plan_mapping.read().await;
                let msp = state.managed_session_paths.read().await;
                let persist: Vec<serde_json::Value> = msp.iter().map(|(path, id)| {
                    let plan = mapping.get(id).cloned().unwrap_or_default();
                    serde_json::json!({"session_id": id.to_string(), "path": path, "plan": plan})
                }).collect();
                if let Ok(json) = serde_json::to_string_pretty(&persist) {
                    let _ = tokio::fs::write("/data/noaide/managed-sessions.json", json).await;
                }
            }
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

/// DELETE /api/sessions/{id} — Delete a session and its JSONL files.
async fn api_delete_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl axum::response::IntoResponse {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "invalid session id"})),
        );
    };

    // Remove from ECS world
    {
        let mut world = state.ecs.write().await;
        world.despawn_session(uuid);
    }

    // Delete JSONL file(s)
    let paths = state.session_paths.read().await;
    if let Some(jsonl_path) = paths.get(&uuid) {
        let path = jsonl_path.clone();
        drop(paths);
        if let Err(e) = tokio::fs::remove_file(&path).await {
            tracing::warn!(error = %e, path = %path.display(), "failed to delete JSONL file");
        } else {
            info!(session = %uuid, path = %path.display(), "deleted JSONL file");
        }
        // Remove from session_paths
        state.session_paths.write().await.remove(&uuid);
    }

    // Remove from cli types
    state.session_cli_types.write().await.remove(&uuid);

    info!(session = %uuid, "session deleted via API");
    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!({"ok": true, "deleted": id})),
    )
}

// ── Append Message Handler ──────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct QueueImagesRequest {
    images: Vec<serde_json::Value>,
}

/// Queue images for injection into the next API request for a managed session.
///
/// The proxy handler will pick these up when the CLI tool makes its next
/// /v1/messages call and inject them as image content blocks into the
/// last user message. This enables multimodal input through the GUI.
async fn api_queue_images(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<QueueImagesRequest>,
) -> impl axum::response::IntoResponse {
    if body.images.is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "no images provided"})),
        );
    }

    // Resolve the managed session UUID — the path `id` could be either
    // the JSONL session ID or the managed session ID. For the proxy we
    // need the managed session UUID because that's what appears in the
    // /s/{uuid}/... proxy path prefix.
    let managed_id = {
        let mgr = state.session_manager.read().await;
        // First try direct UUID lookup
        if let Ok(uuid) = Uuid::parse_str(&id) {
            if mgr
                .get(&noaide_server::session::types::SessionId(uuid))
                .is_some()
            {
                Some(uuid.to_string())
            } else {
                // Check if this is a JSONL session linked to a managed session
                let paths = state.managed_session_paths.read().await;
                paths
                    .iter()
                    .find(|(_, jsonl_id)| **jsonl_id == uuid)
                    .map(|(managed_id, _)| managed_id.to_string())
            }
        } else {
            None
        }
    };

    let target_id = managed_id.unwrap_or_else(|| id.clone());

    let mut pending = state.proxy.pending_images.write().await;
    let entry = pending.entry(target_id.clone()).or_default();
    let count = body.images.len();
    entry.extend(body.images);

    tracing::info!(
        session = %target_id,
        image_count = count,
        total_pending = entry.len(),
        "queued images for proxy injection"
    );

    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!({"ok": true, "queued": count})),
    )
}

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
        category: log.category.clone(),
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
        category: c.category.clone(),
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

// ── File Browser API Endpoints (WP-10) ──────────────────────────────────────

#[derive(serde::Deserialize)]
struct FileListQuery {
    path: Option<String>,
}

#[derive(serde::Deserialize)]
struct FileContentQuery {
    path: String,
}

/// Resolve a session's project root directory from its UUID.
///
/// Same resolution pattern as `resolve_git_repo`: JSONL path → CWD → project root.
/// Falls back to reverse alias for managed sessions.
async fn resolve_session_project_root(
    state: &AppState,
    session_id: &str,
) -> Option<std::path::PathBuf> {
    let uuid = Uuid::parse_str(session_id).ok()?;

    // Try project_watches first (works for managed sessions immediately)
    let watches = state.project_watches.read().await;
    if let Some(root) = watches.get(&uuid).cloned() {
        return Some(root);
    }
    drop(watches);

    // Try direct JSONL path lookup
    let paths = state.session_paths.read().await;
    if let Some(jsonl_path) = paths.get(&uuid).cloned() {
        drop(paths);
        return resolve_session_cwd(&jsonl_path);
    }
    drop(paths);

    // Try reverse alias for managed sessions
    let world = state.ecs.read().await;
    if let Some(jsonl_id) = world.reverse_alias(uuid) {
        drop(world);
        let paths = state.session_paths.read().await;
        if let Some(jsonl_path) = paths.get(&jsonl_id).cloned() {
            return resolve_session_cwd(&jsonl_path);
        }
    }

    None
}

/// GET /api/browse?path=<absolute_path>
///
/// List directories at an absolute path (for the "New Session" directory picker).
/// Returns only directories, sorted alphabetically. Security: rejects paths outside /work and /home.
async fn api_browse_directories(
    Query(query): Query<BrowseQuery>,
) -> impl axum::response::IntoResponse {
    let base = query.path.as_deref().unwrap_or("/work");
    let base_path = std::path::Path::new(base);

    // Security: only allow browsing under /work or /home
    let allowed = base_path.starts_with("/work") || base_path.starts_with("/home");
    if !allowed || base.contains("..") {
        return (
            axum::http::StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"error": "path not allowed"})),
        );
    }

    let mut entries: Vec<serde_json::Value> = Vec::new();

    // Add parent entry unless at root allowed path
    if base != "/work" && base != "/home" {
        if let Some(parent) = base_path.parent() {
            entries.push(serde_json::json!({
                "name": "..",
                "path": parent.to_string_lossy(),
                "isDir": true,
            }));
        }
    }

    let mut dir_entries = match tokio::fs::read_dir(base_path).await {
        Ok(d) => d,
        Err(e) => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            );
        }
    };

    let mut dirs = Vec::new();
    while let Ok(Some(entry)) = dir_entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden dirs and common large dirs
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "__pycache__"
        {
            continue;
        }
        if let Ok(ft) = entry.file_type().await {
            if ft.is_dir() {
                dirs.push(serde_json::json!({
                    "name": name,
                    "path": entry.path().to_string_lossy(),
                    "isDir": true,
                }));
            }
        }
    }

    dirs.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or("")
            .to_lowercase()
            .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
    });
    entries.extend(dirs);

    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!(entries)),
    )
}

#[derive(serde::Deserialize)]
struct BrowseQuery {
    path: Option<String>,
}

/// GET /api/sessions/{id}/files?path=<optional_subdir>
///
/// List files in a session's project directory.
/// Returns JSON array of FileEntry objects, sorted directories-first.
async fn api_list_session_files(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<FileListQuery>,
) -> impl axum::response::IntoResponse {
    let project_root = match resolve_session_project_root(&state, &session_id).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no project directory found for session"})),
            );
        }
    };

    match noaide_server::files::list_directory(&project_root, query.path.as_deref()).await {
        Ok(entries) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!(entries)),
        ),
        Err(e) => {
            let status = match &e {
                noaide_server::files::FileError::PathTraversal => axum::http::StatusCode::FORBIDDEN,
                noaide_server::files::FileError::ProjectNotFound => {
                    axum::http::StatusCode::NOT_FOUND
                }
                noaide_server::files::FileError::Io(io_err)
                    if io_err.kind() == std::io::ErrorKind::NotFound =>
                {
                    axum::http::StatusCode::NOT_FOUND
                }
                _ => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            };
            (
                status,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
        }
    }
}

/// GET /api/sessions/{id}/file?path=<relative_path>
///
/// Read a file's content from a session's project directory.
/// Returns the file content as text with appropriate content type.
async fn api_get_session_file(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<FileContentQuery>,
) -> axum::response::Response {
    use axum::http::{StatusCode, header};
    use axum::response::IntoResponse;

    let project_root = match resolve_session_project_root(&state, &session_id).await {
        Some(p) => p,
        None => {
            return (
                StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no project directory found for session"})),
            )
                .into_response();
        }
    };

    match noaide_server::files::read_file_content(&project_root, &query.path, None).await {
        Ok(file_content) => {
            let content_type = file_content.content_type.clone();
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, content_type)],
                file_content.content,
            )
                .into_response()
        }
        Err(e) => {
            let status = match &e {
                noaide_server::files::FileError::PathTraversal => StatusCode::FORBIDDEN,
                noaide_server::files::FileError::ProjectNotFound => StatusCode::NOT_FOUND,
                noaide_server::files::FileError::FileTooLarge { .. } => {
                    StatusCode::PAYLOAD_TOO_LARGE
                }
                noaide_server::files::FileError::BinaryFile => StatusCode::UNSUPPORTED_MEDIA_TYPE,
                noaide_server::files::FileError::Io(io_err)
                    if io_err.kind() == std::io::ErrorKind::NotFound =>
                {
                    StatusCode::NOT_FOUND
                }
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (
                status,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response()
        }
    }
}

/// PUT /api/sessions/{id}/file
///
/// Save content to a file in a session's project directory.
/// Accepts JSON body with `path` and `content` fields.
async fn api_save_session_file(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    axum::Json(body): axum::Json<SaveFileRequest>,
) -> axum::response::Response {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    let project_root = match resolve_session_project_root(&state, &session_id).await {
        Some(p) => p,
        None => {
            return (
                StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no project directory found for session"})),
            )
                .into_response();
        }
    };

    match noaide_server::files::write_file_content(&project_root, &body.path, &body.content, None)
        .await
    {
        Ok(bytes_written) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({"ok": true, "bytes": bytes_written})),
        )
            .into_response(),
        Err(e) => {
            let status = match &e {
                noaide_server::files::FileError::PathTraversal => StatusCode::FORBIDDEN,
                noaide_server::files::FileError::FileTooLarge { .. } => {
                    StatusCode::PAYLOAD_TOO_LARGE
                }
                noaide_server::files::FileError::Io(io_err)
                    if io_err.kind() == std::io::ErrorKind::PermissionDenied =>
                {
                    StatusCode::FORBIDDEN
                }
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (
                status,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response()
        }
    }
}

#[derive(serde::Deserialize)]
struct SaveFileRequest {
    path: String,
    content: String,
}

// ── Network Rules API Endpoints ─────────────────────────────────────────────

/// Get all network rules for a session.
async fn api_get_network_rules(
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> axum::Json<Vec<noaide_server::proxy::NetworkRule>> {
    axum::Json(state.proxy.network_rules.get_rules(&session_id))
}

/// Replace all network rules for a session.
async fn api_set_network_rules(
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
    axum::Json(rules): axum::Json<Vec<noaide_server::proxy::NetworkRule>>,
) -> StatusCode {
    state.proxy.network_rules.set_rules(&session_id, rules);
    StatusCode::OK
}

/// Add a single network rule to a session.
async fn api_add_network_rule(
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
    axum::Json(rule): axum::Json<noaide_server::proxy::NetworkRule>,
) -> (StatusCode, axum::Json<serde_json::Value>) {
    let id = state.proxy.network_rules.add_rule(&session_id, rule);
    (
        StatusCode::CREATED,
        axum::Json(serde_json::json!({ "id": id })),
    )
}

/// Delete a network rule by ID.
async fn api_delete_network_rule(
    State(state): State<AppState>,
    axum::extract::Path((session_id, rule_id)): axum::extract::Path<(String, String)>,
) -> StatusCode {
    if state.proxy.network_rules.remove_rule(&session_id, &rule_id) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

#[derive(serde::Deserialize)]
struct QuickBlockRequest {
    domain: String,
}

/// Quick-block: create a Block rule for a domain in one call.
async fn api_quick_block_domain(
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
    axum::Json(body): axum::Json<QuickBlockRequest>,
) -> (StatusCode, axum::Json<serde_json::Value>) {
    let rule = noaide_server::proxy::NetworkRule {
        id: String::new(),
        session_id: session_id.clone(),
        domain_pattern: Some(body.domain),
        category_filter: None,
        action: noaide_server::proxy::RuleAction::Block,
        enabled: true,
        priority: 50,
    };
    let id = state.proxy.network_rules.add_rule(&session_id, rule);
    (
        StatusCode::CREATED,
        axum::Json(serde_json::json!({ "id": id })),
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
    #[serde(default)]
    create: bool,
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
    if let Some(sid) = session_id
        && let Ok(uuid) = Uuid::parse_str(sid)
    {
        let paths = state.session_paths.read().await;
        if let Some(jsonl_path) = paths.get(&uuid).cloned() {
            drop(paths);
            return resolve_session_cwd(&jsonl_path);
        }
        // Try reverse alias for managed sessions
        let world = state.ecs.read().await;
        if let Some(jsonl_id) = world.reverse_alias(uuid)
            && let Some(jsonl_path) = state.session_paths.read().await.get(&jsonl_id).cloned()
        {
            return resolve_session_cwd(&jsonl_path);
        }
    }
    // Fallback: use noaide's own project directory
    let cwd = std::env::current_dir().ok()?;
    find_git_root(&cwd)
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
        Err(e) => {
            tracing::warn!(error = %e, "git status failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
        }
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
        Err(e) => {
            tracing::warn!(error = %e, "git branches failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
        }
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
        Err(e) => {
            tracing::warn!(error = %e, "git log failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
        }
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
        Err(e) => {
            tracing::warn!(error = %e, file = %query.file, "git blame failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
        }
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
    let result = if body.create {
        noaide_server::git::create_branch(&repo_path, &body.branch)
    } else {
        noaide_server::git::checkout(&repo_path, &body.branch)
    };
    match result {
        Ok(()) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({"ok": true})),
        ),
        Err(e) => {
            tracing::warn!(error = %e, branch = %body.branch, "git checkout failed");
            (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
        }
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
        Err(e) => {
            tracing::warn!(error = %e, "git stage failed");
            (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
        }
    }
}

async fn api_git_unstage(
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
    match noaide_server::git::unstage(&repo_path, &path_refs) {
        Ok(()) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({"ok": true})),
        ),
        Err(e) => {
            tracing::warn!(error = %e, "git unstage failed");
            (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
        }
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
        Err(e) => {
            tracing::warn!(error = %e, "git commit failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": e.to_string()})),
            )
        }
    }
}

// ── Git PR Integration (via gh CLI) ──────────────────────────────────────

async fn api_git_pr_list(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<GitSessionQuery>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, query.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return axum::Json(serde_json::json!({"error": "no git repo"}));
        }
    };
    let output = tokio::process::Command::new("gh")
        .args([
            "pr",
            "list",
            "--json",
            "number,title,state,headRefName,url",
            "--limit",
            "20",
        ])
        .current_dir(&repo_path)
        .output()
        .await;
    match output {
        Ok(out) if out.status.success() => {
            let json_str = String::from_utf8_lossy(&out.stdout);
            match serde_json::from_str::<serde_json::Value>(&json_str) {
                Ok(val) => axum::Json(val),
                Err(_) => axum::Json(serde_json::json!([])),
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            axum::Json(serde_json::json!({"error": stderr.to_string()}))
        }
        Err(e) => axum::Json(serde_json::json!({"error": format!("gh not found: {e}")})),
    }
}

#[derive(serde::Deserialize)]
struct GitPrCreateBody {
    session_id: Option<String>,
    title: String,
    body: Option<String>,
}

async fn api_git_pr_create(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<GitPrCreateBody>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, body.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repo"})),
            );
        }
    };
    let mut args = vec!["pr", "create", "--title", &body.title];
    let body_text = body.body.unwrap_or_default();
    if !body_text.is_empty() {
        args.extend(["--body", &body_text]);
    }
    let output = tokio::process::Command::new("gh")
        .args(&args)
        .current_dir(&repo_path)
        .output()
        .await;
    match output {
        Ok(out) if out.status.success() => {
            let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (
                axum::http::StatusCode::OK,
                axum::Json(serde_json::json!({"ok": true, "url": url})),
            )
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"error": stderr.to_string()})),
            )
        }
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": format!("gh not found: {e}")})),
        ),
    }
}

// ── Git Hunk-Level Staging ───────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct GitDiffHunksQuery {
    session_id: Option<String>,
    path: String,
}

async fn api_git_diff_hunks(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<GitDiffHunksQuery>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, query.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repo"})),
            );
        }
    };
    match noaide_server::git::diff_hunks(&repo_path, &query.path) {
        Ok(hunks) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!(hunks)),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

#[derive(serde::Deserialize)]
struct GitStageHunkBody {
    session_id: Option<String>,
    path: String,
    hunk_index: usize,
}

async fn api_git_stage_hunk(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<GitStageHunkBody>,
) -> impl axum::response::IntoResponse {
    let repo_path = match resolve_git_repo(&state, body.session_id.as_deref()).await {
        Some(p) => p,
        None => {
            return (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({"error": "no git repo"})),
            );
        }
    };
    match noaide_server::git::stage_hunk(&repo_path, &body.path, body.hunk_index) {
        Ok(()) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({"ok": true})),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

// ── File Serving — Serve media files created by LLMs for inline rendering ──

#[derive(serde::Deserialize)]
struct FileServeParams {
    path: String,
    session_id: Option<String>,
}

/// GET /api/files?path=<encoded>&session_id=<uuid>
///
/// Serves media files (images, video, audio) created by LLMs for inline
/// rendering in the chat. Security: extension whitelist, canonicalize path,
/// must be under /tmp/ or session CWD, max 50MB.
async fn api_serve_file(
    State(state): State<AppState>,
    Query(params): Query<FileServeParams>,
) -> axum::response::Response {
    use axum::http::{StatusCode, header};
    use axum::response::IntoResponse;

    let ext_map: &[(&str, &str)] = &[
        (".png", "image/png"),
        (".jpg", "image/jpeg"),
        (".jpeg", "image/jpeg"),
        (".gif", "image/gif"),
        (".svg", "image/svg+xml"),
        (".webp", "image/webp"),
        (".bmp", "image/bmp"),
        (".avif", "image/avif"),
        (".mp4", "video/mp4"),
        (".webm", "video/webm"),
        (".mp3", "audio/mpeg"),
        (".wav", "audio/wav"),
        (".ogg", "audio/ogg"),
        (".m4a", "audio/mp4"),
    ];

    // 1. Extension whitelist
    let path_lower = params.path.to_lowercase();
    let content_type = match ext_map.iter().find(|(ext, _)| path_lower.ends_with(ext)) {
        Some((_, mime)) => *mime,
        None => {
            return (StatusCode::BAD_REQUEST, "unsupported file extension").into_response();
        }
    };

    // 2. Canonicalize path (resolves symlinks, ".." etc.)
    let canonical = match std::fs::canonicalize(&params.path) {
        Ok(p) => p,
        Err(_) => {
            return (StatusCode::NOT_FOUND, "file not found").into_response();
        }
    };

    // 3. Path must be under /tmp/ or the session's working directory
    let canonical_str = canonical.to_string_lossy();
    let under_tmp = canonical_str.starts_with("/tmp/");

    let under_session_cwd = if let Some(ref sid) = params.session_id {
        if let Ok(uuid) = Uuid::parse_str(sid) {
            let paths = state.session_paths.read().await;
            if let Some(jsonl_path) = paths.get(&uuid).cloned() {
                drop(paths);
                if let Some(cwd) = resolve_session_cwd(&jsonl_path) {
                    canonical_str.starts_with(&cwd.to_string_lossy().as_ref())
                } else {
                    false
                }
            } else {
                drop(paths);
                // Try reverse alias for managed sessions
                let world = state.ecs.read().await;
                if let Some(jsonl_id) = world.reverse_alias(uuid) {
                    let paths = state.session_paths.read().await;
                    if let Some(jsonl_path) = paths.get(&jsonl_id).cloned() {
                        drop(paths);
                        if let Some(cwd) = resolve_session_cwd(&jsonl_path) {
                            canonical_str.starts_with(&cwd.to_string_lossy().as_ref())
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
        } else {
            false
        }
    } else {
        false
    };

    if !under_tmp && !under_session_cwd {
        return (StatusCode::FORBIDDEN, "path not allowed").into_response();
    }

    // 4. File size check (max 50MB)
    let metadata = match tokio::fs::metadata(&canonical).await {
        Ok(m) => m,
        Err(_) => {
            return (StatusCode::NOT_FOUND, "file not found").into_response();
        }
    };

    if metadata.len() > 50 * 1024 * 1024 {
        return (StatusCode::BAD_REQUEST, "file too large (max 50MB)").into_response();
    }

    // 5. Read and serve
    let bytes = match tokio::fs::read(&canonical).await {
        Ok(b) => b,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "failed to read file").into_response();
        }
    };

    axum::http::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header("x-content-type-options", "nosniff")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(axum::body::Body::from(bytes))
        .unwrap()
}

// ── Teams API — Discover team configs and build topology graphs ────────────

/// GET /api/teams — List all discovered teams from ~/.claude/teams/
async fn api_get_teams() -> impl axum::response::IntoResponse {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
    let claude_dir = PathBuf::from(home).join(".claude");
    let (discovery, _rx) = TeamDiscovery::new(&claude_dir);
    let teams = discovery.scan().await;

    tracing::info!(teams_count = teams.len(), "teams discovery complete");

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

            // Enrich with inbox messages (real from/to/summary data)
            let team_dir = t.config_path.parent().unwrap_or(std::path::Path::new(""));
            let inbox_messages = load_inboxes(team_dir).await;
            for msg in &inbox_messages {
                builder.add_message(&msg.from, &msg.to, "message", msg.summary.clone());
            }

            // Derive agent status from tasks
            if let Some(task_dir) = &t.task_dir {
                let tasks = load_tasks(task_dir).await;
                for member in &t.config.members {
                    let agent_tasks: Vec<_> = tasks
                        .iter()
                        .filter(|task| task.owner.as_deref() == Some(&member.name))
                        .collect();
                    if agent_tasks.is_empty() {
                        // No tasks assigned — check if agent has inbox messages
                        if inbox_messages
                            .iter()
                            .any(|m| m.from == member.name || m.to == member.name)
                        {
                            builder.set_status(&member.name, AgentStatus::Idle);
                        }
                        // else: leave as Unknown
                    } else if agent_tasks.iter().any(|t| t.status == "in_progress") {
                        builder.set_status(&member.name, AgentStatus::Active);
                    } else if agent_tasks.iter().all(|t| t.status == "completed") {
                        builder.set_status(&member.name, AgentStatus::Shutdown);
                    } else {
                        builder.set_status(&member.name, AgentStatus::Idle);
                    }
                }
            }

            let topology = builder.build();
            let agents_active = topology
                .nodes
                .iter()
                .filter(|n| n.status == AgentStatus::Active)
                .count();
            let total_messages: u64 =
                topology.nodes.iter().map(|n| n.message_count).sum::<u64>() / 2; // counted on both sides
            tracing::info!(
                team = %team_name,
                agents_active = agents_active,
                team_messages_total = total_messages,
                "team topology built"
            );

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

/// GET /api/teams/:name/tasks — Get all tasks for a specific team
async fn api_get_team_tasks(Path(team_name): Path<String>) -> impl axum::response::IntoResponse {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
    let claude_dir = PathBuf::from(home).join(".claude");
    let (discovery, _rx) = TeamDiscovery::new(&claude_dir);
    let teams = discovery.scan().await;

    let team = teams.iter().find(|t| t.config.name == team_name);
    match team {
        Some(t) => match &t.task_dir {
            Some(task_dir) => {
                let tasks = load_tasks(task_dir).await;
                (
                    axum::http::StatusCode::OK,
                    axum::Json(serde_json::to_value(&tasks).unwrap_or_default()),
                )
            }
            None => (
                axum::http::StatusCode::OK,
                axum::Json(serde_json::json!([])),
            ),
        },
        None => (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": format!("team '{}' not found", team_name)})),
        ),
    }
}

/// Check if a PID belongs to a managed Claude Code session.
///
/// Managed sessions store the PID of the spawned CLI process.
/// Compares the event PID with all known Claude PIDs to determine
/// if the file change was caused by Claude (for conflict detection, ADR-5).
async fn is_claude_pid(ecs: &SharedEcsWorld, pid: u32) -> bool {
    let world = ecs.read().await;
    // Query all session components for managed sessions with matching PID.
    // ManagedSession stores its PID, but currently we don't have a direct
    // PID field in SessionComponent. For now, we check if any managed session
    // has this PID via the session manager. This is a heuristic until eBPF
    // provides authoritative PID-to-session mapping on bare-metal.
    //
    // TODO: When eBPF is active on bare-metal, replace this heuristic with
    // direct PID lookup from the eBPF ring buffer.
    let _ = (world, pid);
    false
}

fn find_ca_cert() -> Option<Vec<u8>> {
    let paths = [
        PathBuf::from("./certs/rootCA.pem"),
        PathBuf::from(format!(
            "{}/.local/share/mkcert/rootCA.pem",
            std::env::var("HOME").unwrap_or_default()
        )),
    ];
    for path in &paths {
        if let Ok(pem) = std::fs::read(path) {
            return Some(pem);
        }
    }
    None
}

async fn api_get_ca_cert() -> axum::response::Response {
    if let Some(pem) = find_ca_cert() {
        return axum::response::Response::builder()
            .header("content-type", "application/x-pem-file")
            .header(
                "content-disposition",
                "attachment; filename=\"noaide-ca.pem\"",
            )
            .body(axum::body::Body::from(pem))
            .unwrap();
    }

    axum::response::Response::builder()
        .status(axum::http::StatusCode::NOT_FOUND)
        .body(axum::body::Body::from("CA certificate not found"))
        .unwrap()
}

/// Serve CA cert as .crt with x509 content-type — Android auto-imports this.
async fn api_get_ca_cert_crt() -> axum::response::Response {
    if let Some(pem_bytes) = find_ca_cert() {
        return axum::response::Response::builder()
            .header("content-type", "application/x-x509-ca-cert")
            .header(
                "content-disposition",
                "attachment; filename=\"noaide-ca.crt\"",
            )
            .body(axum::body::Body::from(pem_bytes))
            .unwrap();
    }

    axum::response::Response::builder()
        .status(axum::http::StatusCode::NOT_FOUND)
        .body(axum::body::Body::from("CA certificate not found"))
        .unwrap()
}

async fn api_server_info(State(state): State<AppState>) -> axum::Json<serde_json::Value> {
    let mut addresses = Vec::new();

    // Collect all non-loopback IPv4 addresses from network interfaces
    if let Ok(output) = std::process::Command::new("ip")
        .args(["-4", "-o", "addr", "show"])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            // Format: "2: wlp6s0    inet 10.0.0.57/8 ..."
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 && parts[2] == "inet" {
                if let Some(ip) = parts[3].split('/').next() {
                    if !ip.starts_with("127.") && !ip.starts_with("172.") {
                        let iface = parts[1].trim_end_matches(':');
                        let is_wifi = iface.starts_with("wl");
                        addresses.push(serde_json::json!({
                            "ip": ip,
                            "iface": iface,
                            "wifi": is_wifi,
                        }));
                    }
                }
            }
        }
    }

    // Prefer WiFi interface for mobile QR code
    let lan_ip = addresses
        .iter()
        .find(|a| a["wifi"].as_bool() == Some(true))
        .or_else(|| addresses.first())
        .and_then(|a| a["ip"].as_str())
        .unwrap_or("")
        .to_string();

    axum::Json(serde_json::json!({
        "lanIp": lan_ip,
        "addresses": addresses,
        "whisperEnabled": state.whisper_enabled,
        "whisperPort": state.whisper_port,
    }))
}

/// WebSocket proxy: forwards browser WS connection to the whisper sidecar.
/// This avoids mixed-content issues (browser HTTPS → ws:// localhost).
async fn api_ws_transcribe(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> axum::response::Response {
    if !state.whisper_enabled {
        return axum::response::Response::builder()
            .status(axum::http::StatusCode::SERVICE_UNAVAILABLE)
            .body(axum::body::Body::from("whisper disabled"))
            .unwrap();
    }
    ws.on_upgrade(move |socket| ws_transcribe_proxy(socket, state.whisper_port))
}

async fn ws_transcribe_proxy(browser_ws: WebSocket, whisper_port: u16) {
    use tokio_tungstenite::tungstenite::Message as TungMsg;

    let sidecar_url = format!("ws://127.0.0.1:{whisper_port}/ws/transcribe");
    let connect_result = tokio_tungstenite::connect_async(&sidecar_url).await;

    let (sidecar_ws, _) = match connect_result {
        Ok(pair) => pair,
        Err(e) => {
            warn!(error = %e, "failed to connect to whisper sidecar");
            return;
        }
    };

    use futures_util::{SinkExt, StreamExt as FutStreamExt};
    let (mut sidecar_tx, mut sidecar_rx) = sidecar_ws.split();
    let (mut browser_tx, mut browser_rx) = browser_ws.split();

    // Browser → Sidecar
    let to_sidecar = async {
        while let Some(Ok(msg)) = FutStreamExt::next(&mut browser_rx).await {
            let tung_msg = match msg {
                WsMessage::Binary(data) => TungMsg::Binary(data),
                WsMessage::Text(text) => TungMsg::Text(text.as_str().into()),
                WsMessage::Close(_) => break,
                _ => continue,
            };
            if sidecar_tx.send(tung_msg).await.is_err() {
                break;
            }
        }
    };

    // Sidecar → Browser
    let to_browser = async {
        while let Some(Ok(msg)) = FutStreamExt::next(&mut sidecar_rx).await {
            let ws_msg = match msg {
                TungMsg::Binary(data) => WsMessage::Binary(data),
                TungMsg::Text(text) => WsMessage::Text(text.to_string().into()),
                TungMsg::Close(_) => break,
                _ => continue,
            };
            if browser_tx.send(ws_msg).await.is_err() {
                break;
            }
        }
    };

    // Run both directions concurrently; stop when either side closes
    tokio::select! {
        _ = to_sidecar => {}
        _ = to_browser => {}
    }

    debug!("whisper WS proxy session ended");
}
