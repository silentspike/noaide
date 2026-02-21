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
    info!(
        sessions = 0,
        messages = 0,
        "ecs world initialized"
    );

    // Database
    let db_path = std::env::var("NOAIDE_DB_PATH").unwrap_or_else(|_| "/data/noaide/ide.db".into());
    let _db = Db::open(&db_path).await?;

    // Keep handles alive
    let _ecs = ecs;

    info!("noaide-server ready");

    Ok(())
}
