use limbo::Connection;

// Limbo constraint: TEXT PRIMARY KEY not supported.
// Use rowid (implicit) and CREATE UNIQUE INDEX for UUID id columns.
// Also: REFERENCES (foreign keys) not enforced by Limbo.

pub const CREATE_SESSIONS: &str = "\
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    model TEXT,
    started_at INTEGER NOT NULL,
    cost REAL
)";

pub const CREATE_MESSAGES: &str = "\
CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    tokens INTEGER,
    hidden INTEGER DEFAULT 0,
    message_type TEXT NOT NULL DEFAULT 'text'
)";

pub const CREATE_FILES: &str = "\
CREATE TABLE IF NOT EXISTS files (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    path TEXT NOT NULL,
    modified INTEGER NOT NULL,
    size INTEGER NOT NULL
)";

pub const CREATE_TASKS: &str = "\
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    owner TEXT
)";

pub const CREATE_AGENTS: &str = "\
CREATE TABLE IF NOT EXISTS agents (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    parent_id TEXT
)";

pub const CREATE_API_REQUESTS: &str = "\
CREATE TABLE IF NOT EXISTS api_requests (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    request_body TEXT,
    response_body TEXT,
    status_code INTEGER,
    latency_ms INTEGER,
    timestamp INTEGER NOT NULL
)";

// Standalone FTS5 table (no content= since Limbo lacks triggers)
pub const CREATE_MESSAGES_FTS: &str = "\
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    message_id UNINDEXED, content
)";

// Unique indexes on id columns (replacing TEXT PRIMARY KEY)
pub const CREATE_INDEX_SESSIONS_ID: &str =
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_id ON sessions(id)";

pub const CREATE_INDEX_MESSAGES_ID: &str =
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_id ON messages(id)";

pub const CREATE_INDEX_FILES_ID: &str =
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_files_id ON files(id)";

pub const CREATE_INDEX_TASKS_ID: &str =
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_id ON tasks(id)";

pub const CREATE_INDEX_AGENTS_ID: &str =
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_id ON agents(id)";

pub const CREATE_INDEX_API_REQUESTS_ID: &str =
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_api_requests_id ON api_requests(id)";

// Foreign-key-like indexes on session_id columns
pub const CREATE_INDEX_MESSAGES_SESSION: &str =
    "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)";

pub const CREATE_INDEX_FILES_SESSION: &str =
    "CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id)";

pub const CREATE_INDEX_TASKS_SESSION: &str =
    "CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)";

pub const CREATE_INDEX_AGENTS_SESSION: &str =
    "CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)";

pub const CREATE_INDEX_API_REQUESTS_SESSION: &str =
    "CREATE INDEX IF NOT EXISTS idx_api_requests_session ON api_requests(session_id)";

// Tables are safe with IF NOT EXISTS
const TABLE_STATEMENTS: &[&str] = &[
    CREATE_SESSIONS,
    CREATE_MESSAGES,
    CREATE_FILES,
    CREATE_TASKS,
    CREATE_AGENTS,
    CREATE_API_REQUESTS,
];

// Limbo's IF NOT EXISTS for indexes is broken — ignore "already exists" errors
const INDEX_STATEMENTS: &[&str] = &[
    CREATE_INDEX_SESSIONS_ID,
    CREATE_INDEX_MESSAGES_ID,
    CREATE_INDEX_FILES_ID,
    CREATE_INDEX_TASKS_ID,
    CREATE_INDEX_AGENTS_ID,
    CREATE_INDEX_API_REQUESTS_ID,
    CREATE_INDEX_MESSAGES_SESSION,
    CREATE_INDEX_FILES_SESSION,
    CREATE_INDEX_TASKS_SESSION,
    CREATE_INDEX_AGENTS_SESSION,
    CREATE_INDEX_API_REQUESTS_SESSION,
];

/// Run all schema migrations. Idempotent.
/// Returns whether FTS5 is available.
pub async fn migrate(conn: &Connection) -> Result<bool, limbo::Error> {
    // Tables: IF NOT EXISTS works correctly
    for stmt in TABLE_STATEMENTS {
        conn.execute(stmt, ()).await?;
    }

    // Indexes: IF NOT EXISTS is broken in Limbo — ignore "already exists" errors
    for stmt in INDEX_STATEMENTS {
        match conn.execute(stmt, ()).await {
            Ok(_) => {}
            Err(e) if e.to_string().contains("already exists") => {
                // Index already exists from previous run — safe to ignore
            }
            Err(e) => return Err(e),
        }
    }

    // FTS5 is optional — Limbo may not support it in all versions
    let fts5_available = match conn.execute(CREATE_MESSAGES_FTS, ()).await {
        Ok(_) => {
            tracing::info!("fts5 virtual table created");
            true
        }
        Err(e) if e.to_string().contains("already exists") => {
            true // FTS table exists from previous run
        }
        Err(e) => {
            tracing::warn!(error = %e, "fts5 not available, full-text search disabled");
            false
        }
    };

    Ok(fts5_available)
}
