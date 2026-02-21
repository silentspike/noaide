use std::path::PathBuf;

use tracing::info;

use noaide_server::db::Db;
use noaide_server::ecs::EcsWorld;

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
    for path_str in watch_paths.split(':') {
        let path = PathBuf::from(path_str);
        if path.exists() {
            watcher.watch(&path).await?;
            info!(path = %path.display(), "watching directory");
        } else {
            tracing::warn!(path = %path.display(), "watch path does not exist, skipping");
        }
    }

    // Keep handles alive
    let _ecs = ecs;
    let _watcher = watcher;

    info!("noaide-server ready");

    Ok(())
}
