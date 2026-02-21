use limbo::{Builder, Connection, Database, Value};
use tracing::info;
use uuid::Uuid;

use crate::ecs::components::*;

use super::schema;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("limbo error: {0}")]
    Limbo(#[from] limbo::Error),
    #[error("unexpected value type at column {column}: expected {expected}")]
    TypeError {
        column: usize,
        expected: &'static str,
    },
    #[error("migration failed: {0}")]
    Migration(String),
}

pub type DbResult<T> = Result<T, DbError>;

/// Async database wrapper around Limbo.
///
/// Limbo is single-threaded per connection but its Connection type is
/// Send+Sync (wrapped in Arc<Mutex>). All operations are async.
pub struct Db {
    #[allow(dead_code)]
    database: Database,
    conn: Connection,
    fts5_available: bool,
}

impl Db {
    /// Open or create a database at the given path. Runs migrations.
    pub async fn open(path: &str) -> DbResult<Self> {
        info!(path, "opening limbo database");
        let database = Builder::new_local(path).build().await?;
        let conn = database.connect()?;

        info!("running schema migrations");
        let fts5_available = schema::migrate(&conn)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;

        info!(fts5 = fts5_available, "database ready");
        Ok(Self {
            database,
            conn,
            fts5_available,
        })
    }

    pub fn fts5_available(&self) -> bool {
        self.fts5_available
    }

    // === Session CRUD ===

    pub async fn insert_session(&self, s: &SessionComponent) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO sessions (id, path, status, model, started_at, cost) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                limbo::params!(
                    s.id.to_string(),
                    s.path.clone(),
                    session_status_to_str(s.status),
                    option_to_value(&s.model),
                    s.started_at,
                    option_f64_to_value(s.cost)
                ),
            )
            .await?;
        Ok(())
    }

    pub async fn get_sessions(&self) -> DbResult<Vec<SessionComponent>> {
        let mut rows = self
            .conn
            .query("SELECT id, path, status, model, started_at, cost FROM sessions", ())
            .await?;

        let mut result = Vec::new();
        while let Some(row) = rows.next().await? {
            result.push(SessionComponent {
                id: text_to_uuid(&row.get_value(0)?)?,
                path: text_value(&row.get_value(1)?)?,
                status: str_to_session_status(&text_value(&row.get_value(2)?)?),
                model: optional_text(&row.get_value(3)?),
                started_at: int_value(&row.get_value(4)?)?,
                cost: optional_f64(&row.get_value(5)?),
            });
        }
        Ok(result)
    }

    pub async fn get_session_by_id(&self, id: &Uuid) -> DbResult<Option<SessionComponent>> {
        let mut rows = self
            .conn
            .query(
                "SELECT id, path, status, model, started_at, cost FROM sessions WHERE id = ?1",
                limbo::params!(id.to_string()),
            )
            .await?;

        match rows.next().await? {
            Some(row) => Ok(Some(SessionComponent {
                id: text_to_uuid(&row.get_value(0)?)?,
                path: text_value(&row.get_value(1)?)?,
                status: str_to_session_status(&text_value(&row.get_value(2)?)?),
                model: optional_text(&row.get_value(3)?),
                started_at: int_value(&row.get_value(4)?)?,
                cost: optional_f64(&row.get_value(5)?),
            })),
            None => Ok(None),
        }
    }

    pub async fn update_session_status(&self, id: &Uuid, status: SessionStatus) -> DbResult<()> {
        self.conn
            .execute(
                "UPDATE sessions SET status = ?1 WHERE id = ?2",
                limbo::params!(session_status_to_str(status), id.to_string()),
            )
            .await?;
        Ok(())
    }

    // === Message CRUD ===

    pub async fn insert_message(&self, m: &MessageComponent) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO messages (id, session_id, role, content, timestamp, tokens, hidden, message_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                limbo::params!(
                    m.id.to_string(),
                    m.session_id.to_string(),
                    role_to_str(m.role),
                    m.content.clone(),
                    m.timestamp,
                    option_u32_to_value(m.tokens),
                    m.hidden as i64,
                    message_type_to_str(m.message_type)
                ),
            )
            .await?;

        // Manual FTS5 sync (Limbo has no triggers)
        if self.fts5_available {
            self.conn
                .execute(
                    "INSERT INTO messages_fts (message_id, content) VALUES (?1, ?2)",
                    limbo::params!(m.id.to_string(), m.content.clone()),
                )
                .await?;
        }

        Ok(())
    }

    pub async fn get_messages_by_session(
        &self,
        session_id: &Uuid,
    ) -> DbResult<Vec<MessageComponent>> {
        let mut rows = self
            .conn
            .query(
                "SELECT id, session_id, role, content, timestamp, tokens, hidden, message_type FROM messages WHERE session_id = ?1 ORDER BY timestamp",
                limbo::params!(session_id.to_string()),
            )
            .await?;

        let mut result = Vec::new();
        while let Some(row) = rows.next().await? {
            result.push(row_to_message(&row)?);
        }
        Ok(result)
    }

    pub async fn search_messages(&self, query: &str) -> DbResult<Vec<MessageComponent>> {
        let mut rows = if self.fts5_available {
            self.conn
                .query(
                    "SELECT m.id, m.session_id, m.role, m.content, m.timestamp, m.tokens, m.hidden, m.message_type FROM messages m INNER JOIN messages_fts f ON m.id = f.message_id WHERE messages_fts MATCH ?1",
                    limbo::params!(query.to_string()),
                )
                .await?
        } else {
            // Fallback: LIKE query when FTS5 is unavailable
            let like_pattern = format!("%{query}%");
            self.conn
                .query(
                    "SELECT id, session_id, role, content, timestamp, tokens, hidden, message_type FROM messages WHERE content LIKE ?1",
                    limbo::params!(like_pattern),
                )
                .await?
        };

        let mut result = Vec::new();
        while let Some(row) = rows.next().await? {
            result.push(row_to_message(&row)?);
        }
        Ok(result)
    }

    // === File CRUD ===

    pub async fn insert_file(&self, f: &FileComponent) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO files (id, session_id, path, modified, size) VALUES (?1, ?2, ?3, ?4, ?5)",
                limbo::params!(
                    f.id.to_string(),
                    f.session_id.to_string(),
                    f.path.clone(),
                    f.modified,
                    f.size as i64
                ),
            )
            .await?;
        Ok(())
    }

    pub async fn get_files_by_session(&self, session_id: &Uuid) -> DbResult<Vec<FileComponent>> {
        let mut rows = self
            .conn
            .query(
                "SELECT id, session_id, path, modified, size FROM files WHERE session_id = ?1",
                limbo::params!(session_id.to_string()),
            )
            .await?;

        let mut result = Vec::new();
        while let Some(row) = rows.next().await? {
            result.push(FileComponent {
                id: text_to_uuid(&row.get_value(0)?)?,
                session_id: text_to_uuid(&row.get_value(1)?)?,
                path: text_value(&row.get_value(2)?)?,
                modified: int_value(&row.get_value(3)?)?,
                size: int_value(&row.get_value(4)?)? as u64,
            });
        }
        Ok(result)
    }

    // === Task CRUD ===

    pub async fn insert_task(&self, t: &TaskComponent) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO tasks (id, session_id, subject, status, owner) VALUES (?1, ?2, ?3, ?4, ?5)",
                limbo::params!(
                    t.id.to_string(),
                    t.session_id.to_string(),
                    t.subject.clone(),
                    t.status.clone(),
                    option_to_value(&t.owner)
                ),
            )
            .await?;
        Ok(())
    }

    pub async fn get_tasks_by_session(&self, session_id: &Uuid) -> DbResult<Vec<TaskComponent>> {
        let mut rows = self
            .conn
            .query(
                "SELECT id, session_id, subject, status, owner FROM tasks WHERE session_id = ?1",
                limbo::params!(session_id.to_string()),
            )
            .await?;

        let mut result = Vec::new();
        while let Some(row) = rows.next().await? {
            result.push(TaskComponent {
                id: text_to_uuid(&row.get_value(0)?)?,
                session_id: text_to_uuid(&row.get_value(1)?)?,
                subject: text_value(&row.get_value(2)?)?,
                status: text_value(&row.get_value(3)?)?,
                owner: optional_text(&row.get_value(4)?),
            });
        }
        Ok(result)
    }

    // === Agent CRUD ===

    pub async fn insert_agent(&self, a: &AgentComponent) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO agents (id, session_id, name, agent_type, parent_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                limbo::params!(
                    a.id.to_string(),
                    a.session_id.to_string(),
                    a.name.clone(),
                    a.agent_type.clone(),
                    option_uuid_to_value(&a.parent_id)
                ),
            )
            .await?;
        Ok(())
    }

    pub async fn get_agents_by_session(
        &self,
        session_id: &Uuid,
    ) -> DbResult<Vec<AgentComponent>> {
        let mut rows = self
            .conn
            .query(
                "SELECT id, session_id, name, agent_type, parent_id FROM agents WHERE session_id = ?1",
                limbo::params!(session_id.to_string()),
            )
            .await?;

        let mut result = Vec::new();
        while let Some(row) = rows.next().await? {
            result.push(AgentComponent {
                id: text_to_uuid(&row.get_value(0)?)?,
                session_id: text_to_uuid(&row.get_value(1)?)?,
                name: text_value(&row.get_value(2)?)?,
                agent_type: text_value(&row.get_value(3)?)?,
                parent_id: optional_uuid(&row.get_value(4)?),
            });
        }
        Ok(result)
    }

    // === API Request CRUD ===

    pub async fn insert_api_request(&self, r: &ApiRequestComponent) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO api_requests (id, session_id, method, url, request_body, response_body, status_code, latency_ms, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                limbo::params!(
                    r.id.to_string(),
                    r.session_id.to_string(),
                    r.method.clone(),
                    r.url.clone(),
                    option_to_value(&r.request_body),
                    option_to_value(&r.response_body),
                    option_u16_to_value(r.status_code),
                    option_u32_to_value(r.latency_ms),
                    r.timestamp
                ),
            )
            .await?;
        Ok(())
    }

    pub async fn get_api_requests_by_session(
        &self,
        session_id: &Uuid,
    ) -> DbResult<Vec<ApiRequestComponent>> {
        let mut rows = self
            .conn
            .query(
                "SELECT id, session_id, method, url, request_body, response_body, status_code, latency_ms, timestamp FROM api_requests WHERE session_id = ?1",
                limbo::params!(session_id.to_string()),
            )
            .await?;

        let mut result = Vec::new();
        while let Some(row) = rows.next().await? {
            result.push(ApiRequestComponent {
                id: text_to_uuid(&row.get_value(0)?)?,
                session_id: text_to_uuid(&row.get_value(1)?)?,
                method: text_value(&row.get_value(2)?)?,
                url: text_value(&row.get_value(3)?)?,
                request_body: optional_text(&row.get_value(4)?),
                response_body: optional_text(&row.get_value(5)?),
                status_code: optional_int(&row.get_value(6)?).map(|v| v as u16),
                latency_ms: optional_int(&row.get_value(7)?).map(|v| v as u32),
                timestamp: int_value(&row.get_value(8)?)?,
            });
        }
        Ok(result)
    }
}

// === Value conversion helpers ===

fn text_value(v: &Value) -> DbResult<String> {
    match v {
        Value::Text(s) => Ok(s.clone()),
        _ => Err(DbError::TypeError {
            column: 0,
            expected: "text",
        }),
    }
}

fn int_value(v: &Value) -> DbResult<i64> {
    match v {
        Value::Integer(i) => Ok(*i),
        _ => Err(DbError::TypeError {
            column: 0,
            expected: "integer",
        }),
    }
}

fn optional_text(v: &Value) -> Option<String> {
    match v {
        Value::Text(s) => Some(s.clone()),
        _ => None,
    }
}

fn optional_int(v: &Value) -> Option<i64> {
    match v {
        Value::Integer(i) => Some(*i),
        _ => None,
    }
}

fn optional_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Real(f) => Some(*f),
        Value::Integer(i) => Some(*i as f64),
        _ => None,
    }
}

fn optional_uuid(v: &Value) -> Option<Uuid> {
    match v {
        Value::Text(s) => Uuid::parse_str(s).ok(),
        _ => None,
    }
}

fn text_to_uuid(v: &Value) -> DbResult<Uuid> {
    let s = text_value(v)?;
    Uuid::parse_str(&s).map_err(|_| DbError::TypeError {
        column: 0,
        expected: "uuid",
    })
}

fn option_to_value(opt: &Option<String>) -> Value {
    match opt {
        Some(s) => Value::Text(s.clone()),
        None => Value::Null,
    }
}

fn option_f64_to_value(opt: Option<f64>) -> Value {
    match opt {
        Some(f) => Value::Real(f),
        None => Value::Null,
    }
}

fn option_u32_to_value(opt: Option<u32>) -> Value {
    match opt {
        Some(v) => Value::Integer(v as i64),
        None => Value::Null,
    }
}

fn option_u16_to_value(opt: Option<u16>) -> Value {
    match opt {
        Some(v) => Value::Integer(v as i64),
        None => Value::Null,
    }
}

fn option_uuid_to_value(opt: &Option<Uuid>) -> Value {
    match opt {
        Some(u) => Value::Text(u.to_string()),
        None => Value::Null,
    }
}

fn session_status_to_str(s: SessionStatus) -> &'static str {
    match s {
        SessionStatus::Active => "active",
        SessionStatus::Idle => "idle",
        SessionStatus::Archived => "archived",
        SessionStatus::Error => "error",
    }
}

fn str_to_session_status(s: &str) -> SessionStatus {
    match s {
        "active" => SessionStatus::Active,
        "idle" => SessionStatus::Idle,
        "archived" => SessionStatus::Archived,
        "error" => SessionStatus::Error,
        _ => SessionStatus::Active,
    }
}

fn role_to_str(r: MessageRole) -> &'static str {
    match r {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::System => "system",
    }
}

fn str_to_role(s: &str) -> MessageRole {
    match s {
        "user" => MessageRole::User,
        "assistant" => MessageRole::Assistant,
        "system" => MessageRole::System,
        _ => MessageRole::User,
    }
}

fn message_type_to_str(t: MessageType) -> &'static str {
    match t {
        MessageType::Text => "text",
        MessageType::ToolUse => "tool_use",
        MessageType::ToolResult => "tool_result",
        MessageType::Thinking => "thinking",
        MessageType::SystemReminder => "system_reminder",
        MessageType::Error => "error",
    }
}

fn str_to_message_type(s: &str) -> MessageType {
    match s {
        "text" => MessageType::Text,
        "tool_use" => MessageType::ToolUse,
        "tool_result" => MessageType::ToolResult,
        "thinking" => MessageType::Thinking,
        "system_reminder" => MessageType::SystemReminder,
        "error" => MessageType::Error,
        _ => MessageType::Text,
    }
}

fn row_to_message(row: &limbo::Row) -> DbResult<MessageComponent> {
    Ok(MessageComponent {
        id: text_to_uuid(&row.get_value(0)?)?,
        session_id: text_to_uuid(&row.get_value(1)?)?,
        role: str_to_role(&text_value(&row.get_value(2)?)?),
        content: text_value(&row.get_value(3)?)?,
        timestamp: int_value(&row.get_value(4)?)?,
        tokens: optional_int(&row.get_value(5)?).map(|v| v as u32),
        hidden: matches!(row.get_value(6)?, Value::Integer(1)),
        message_type: str_to_message_type(&text_value(&row.get_value(7)?)?),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> Db {
        Db::open(":memory:").await.expect("failed to open test db")
    }

    fn test_session(id: Uuid) -> SessionComponent {
        SessionComponent {
            id,
            path: format!("/home/user/.claude/sessions/{id}"),
            status: SessionStatus::Active,
            model: Some("claude-opus-4-6".to_string()),
            started_at: 1708000000,
            cost: Some(0.05),
        }
    }

    fn test_message(id: Uuid, session_id: Uuid) -> MessageComponent {
        MessageComponent {
            id,
            session_id,
            role: MessageRole::User,
            content: "Hello, how are you?".to_string(),
            timestamp: 1708000001,
            tokens: Some(10),
            hidden: false,
            message_type: MessageType::Text,
        }
    }

    #[tokio::test]
    async fn create_and_migrate() {
        let _db = test_db().await;
    }

    #[tokio::test]
    async fn insert_and_get_session() {
        let db = test_db().await;
        let sid = Uuid::new_v4();
        let session = test_session(sid);

        db.insert_session(&session).await.unwrap();

        let sessions = db.get_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, sid);
        assert_eq!(sessions[0].status, SessionStatus::Active);
        assert_eq!(sessions[0].model, Some("claude-opus-4-6".to_string()));

        let found = db.get_session_by_id(&sid).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().path, session.path);

        let not_found = db.get_session_by_id(&Uuid::new_v4()).await.unwrap();
        assert!(not_found.is_none());
    }

    #[tokio::test]
    async fn update_session_status_roundtrip() {
        let db = test_db().await;
        let sid = Uuid::new_v4();
        db.insert_session(&test_session(sid)).await.unwrap();

        db.update_session_status(&sid, SessionStatus::Idle)
            .await
            .unwrap();

        let s = db.get_session_by_id(&sid).await.unwrap().unwrap();
        assert_eq!(s.status, SessionStatus::Idle);
    }

    #[tokio::test]
    async fn insert_and_get_messages() {
        let db = test_db().await;
        let sid = Uuid::new_v4();
        db.insert_session(&test_session(sid)).await.unwrap();

        let m1 = test_message(Uuid::new_v4(), sid);
        let m2 = MessageComponent {
            id: Uuid::new_v4(),
            session_id: sid,
            role: MessageRole::Assistant,
            content: "I'm doing well, thanks!".to_string(),
            timestamp: 1708000002,
            tokens: Some(15),
            hidden: false,
            message_type: MessageType::Text,
        };

        db.insert_message(&m1).await.unwrap();
        db.insert_message(&m2).await.unwrap();

        let messages = db.get_messages_by_session(&sid).await.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, MessageRole::User);
        assert_eq!(messages[1].role, MessageRole::Assistant);
    }

    #[tokio::test]
    async fn fts5_search() {
        let db = test_db().await;
        let sid = Uuid::new_v4();
        db.insert_session(&test_session(sid)).await.unwrap();

        let m1 = MessageComponent {
            id: Uuid::new_v4(),
            session_id: sid,
            role: MessageRole::User,
            content: "implement the ECS world module".to_string(),
            timestamp: 1708000001,
            tokens: None,
            hidden: false,
            message_type: MessageType::Text,
        };
        let m2 = MessageComponent {
            id: Uuid::new_v4(),
            session_id: sid,
            role: MessageRole::Assistant,
            content: "I will create the database schema".to_string(),
            timestamp: 1708000002,
            tokens: None,
            hidden: false,
            message_type: MessageType::Text,
        };

        db.insert_message(&m1).await.unwrap();
        db.insert_message(&m2).await.unwrap();

        let results = db.search_messages("ECS").await.unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].content.contains("ECS"));

        let results = db.search_messages("database").await.unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].content.contains("database"));

        let results = db.search_messages("nonexistent").await.unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn no_data_loss_reconnect() {
        // Use a temp file so we can close and reopen
        let tmp = std::env::temp_dir().join(format!("noaide-test-{}.db", Uuid::new_v4()));
        let path = tmp.to_str().unwrap();

        let sid = Uuid::new_v4();
        {
            let db = Db::open(path).await.unwrap();
            db.insert_session(&test_session(sid)).await.unwrap();
            db.insert_message(&test_message(Uuid::new_v4(), sid))
                .await
                .unwrap();
        }

        // Reopen
        {
            let db = Db::open(path).await.unwrap();
            let sessions = db.get_sessions().await.unwrap();
            assert_eq!(sessions.len(), 1);
            assert_eq!(sessions[0].id, sid);

            let messages = db.get_messages_by_session(&sid).await.unwrap();
            assert_eq!(messages.len(), 1);
        }

        // Cleanup
        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_file(format!("{}-wal", path));
        let _ = std::fs::remove_file(format!("{}-shm", path));
    }
}
