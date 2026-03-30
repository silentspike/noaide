use std::collections::HashMap;
use std::sync::Arc;

use hecs::{Entity, World};
use tokio::sync::RwLock;
use uuid::Uuid;

use super::components::*;

/// Thread-safe ECS world handle for use with tokio.
pub type SharedEcsWorld = Arc<RwLock<EcsWorld>>;

/// Wrapper around hecs::World with secondary indexes for session-based lookups.
///
/// hecs does not support value-based filtering (no "WHERE session_id = X"),
/// so we maintain HashMap indexes that map session_id -> Vec<Entity>.
/// Query methods return cloned data because hecs::Ref<T> cannot escape the borrow.
pub struct EcsWorld {
    world: World,
    session_index: HashMap<Uuid, Entity>,
    message_index: HashMap<Uuid, Vec<Entity>>,
    file_index: HashMap<Uuid, Vec<Entity>>,
    task_index: HashMap<Uuid, Vec<Entity>>,
    agent_index: HashMap<Uuid, Vec<Entity>>,
    api_request_index: HashMap<Uuid, Vec<Entity>>,
    cache_meta_index: HashMap<Uuid, Entity>,
    /// Maps JSONL session UUID → managed session UUID.
    /// When a managed session spawns a CLI process, the CLI creates its own
    /// session ID in its JSONL file. This alias redirects all data (messages,
    /// files, tasks, etc.) from the CLI's session to the managed session so
    /// the frontend sees everything under one session.
    session_aliases: HashMap<Uuid, Uuid>,
}

impl EcsWorld {
    pub fn new() -> Self {
        Self {
            world: World::new(),
            session_index: HashMap::new(),
            message_index: HashMap::new(),
            file_index: HashMap::new(),
            task_index: HashMap::new(),
            agent_index: HashMap::new(),
            api_request_index: HashMap::new(),
            cache_meta_index: HashMap::new(),
            session_aliases: HashMap::new(),
        }
    }

    /// Create a thread-safe shared handle.
    pub fn shared(self) -> SharedEcsWorld {
        Arc::new(RwLock::new(self))
    }

    // === Session Aliases (managed ↔ JSONL linking) ===

    /// Register an alias: data for `jsonl_id` will be stored under `managed_id`.
    /// This links a CLI-created JSONL session to its noaide-managed session.
    pub fn add_session_alias(&mut self, jsonl_id: Uuid, managed_id: Uuid) {
        self.session_aliases.insert(jsonl_id, managed_id);
    }

    /// Resolve a session ID through the alias table.
    /// Returns the managed session ID if an alias exists, otherwise the input ID.
    pub fn resolve_alias(&self, id: Uuid) -> Uuid {
        self.session_aliases.get(&id).copied().unwrap_or(id)
    }

    /// Reverse-resolve: find the JSONL session ID that maps to a managed session ID.
    /// Returns None if no alias points to this managed ID.
    pub fn reverse_alias(&self, managed_id: Uuid) -> Option<Uuid> {
        self.session_aliases
            .iter()
            .find(|(_, mid)| **mid == managed_id)
            .map(|(jsonl_id, _)| *jsonl_id)
    }

    // === Spawn ===

    pub fn spawn_session(&mut self, session: SessionComponent) -> Entity {
        let id = session.id;
        let entity = self.world.spawn((session,));
        self.session_index.insert(id, entity);
        entity
    }

    pub fn despawn_session(&mut self, session_id: Uuid) {
        if let Some(entity) = self.session_index.remove(&session_id) {
            let _ = self.world.despawn(entity);
        }
    }

    pub fn spawn_message(&mut self, mut msg: MessageComponent) -> Entity {
        // Resolve alias: if this message belongs to a JSONL session that's linked
        // to a managed session, redirect it to the managed session.
        let session_id = self.resolve_alias(msg.session_id);
        msg.session_id = session_id;
        let entity = self.world.spawn((msg,));
        self.message_index
            .entry(session_id)
            .or_default()
            .push(entity);
        entity
    }

    pub fn spawn_file(&mut self, mut file: FileComponent) -> Entity {
        let session_id = self.resolve_alias(file.session_id);
        file.session_id = session_id;
        let entity = self.world.spawn((file,));
        self.file_index.entry(session_id).or_default().push(entity);
        entity
    }

    pub fn spawn_task(&mut self, mut task: TaskComponent) -> Entity {
        let session_id = self.resolve_alias(task.session_id);
        task.session_id = session_id;
        let entity = self.world.spawn((task,));
        self.task_index.entry(session_id).or_default().push(entity);
        entity
    }

    pub fn spawn_agent(&mut self, mut agent: AgentComponent) -> Entity {
        let session_id = self.resolve_alias(agent.session_id);
        agent.session_id = session_id;
        let entity = self.world.spawn((agent,));
        self.agent_index.entry(session_id).or_default().push(entity);
        entity
    }

    pub fn spawn_api_request(&mut self, mut req: ApiRequestComponent) -> Entity {
        let session_id = self.resolve_alias(req.session_id);
        req.session_id = session_id;
        let entity = self.world.spawn((req,));
        self.api_request_index
            .entry(session_id)
            .or_default()
            .push(entity);
        entity
    }

    /// Check if a JSONL session ID is already aliased to a managed session.
    pub fn is_aliased(&self, jsonl_id: Uuid) -> bool {
        self.session_aliases.contains_key(&jsonl_id)
    }

    // === Query (returns cloned data — hecs::Ref cannot escape borrow) ===

    pub fn query_sessions(&self) -> Vec<SessionComponent> {
        let mut query = self.world.query::<&SessionComponent>();
        query.iter().cloned().collect()
    }

    pub fn query_session_by_id(&self, session_id: Uuid) -> Option<SessionComponent> {
        let entity = self.session_index.get(&session_id)?;
        let r = self.world.get::<&SessionComponent>(*entity).ok()?;
        Some((*r).clone())
    }

    pub fn query_messages_by_session(&self, session_id: Uuid) -> Vec<MessageComponent> {
        let Some(entities) = self.message_index.get(&session_id) else {
            return Vec::new();
        };
        entities
            .iter()
            .filter_map(|e| {
                self.world
                    .get::<&MessageComponent>(*e)
                    .ok()
                    .map(|r| (*r).clone())
            })
            .collect()
    }

    pub fn query_files_by_session(&self, session_id: Uuid) -> Vec<FileComponent> {
        let Some(entities) = self.file_index.get(&session_id) else {
            return Vec::new();
        };
        entities
            .iter()
            .filter_map(|e| {
                self.world
                    .get::<&FileComponent>(*e)
                    .ok()
                    .map(|r| (*r).clone())
            })
            .collect()
    }

    pub fn query_tasks_by_session(&self, session_id: Uuid) -> Vec<TaskComponent> {
        let Some(entities) = self.task_index.get(&session_id) else {
            return Vec::new();
        };
        entities
            .iter()
            .filter_map(|e| {
                self.world
                    .get::<&TaskComponent>(*e)
                    .ok()
                    .map(|r| (*r).clone())
            })
            .collect()
    }

    pub fn query_agents_by_session(&self, session_id: Uuid) -> Vec<AgentComponent> {
        let Some(entities) = self.agent_index.get(&session_id) else {
            return Vec::new();
        };
        entities
            .iter()
            .filter_map(|e| {
                self.world
                    .get::<&AgentComponent>(*e)
                    .ok()
                    .map(|r| (*r).clone())
            })
            .collect()
    }

    pub fn query_api_requests_by_session(&self, session_id: Uuid) -> Vec<ApiRequestComponent> {
        let Some(entities) = self.api_request_index.get(&session_id) else {
            return Vec::new();
        };
        entities
            .iter()
            .filter_map(|e| {
                self.world
                    .get::<&ApiRequestComponent>(*e)
                    .ok()
                    .map(|r| (*r).clone())
            })
            .collect()
    }

    // === Update ===

    pub fn update_session_status(&mut self, session_id: Uuid, status: SessionStatus) -> Option<()> {
        let entity = *self.session_index.get(&session_id)?;
        let mut session = self.world.get::<&mut SessionComponent>(entity).ok()?;
        session.status = status;
        Some(())
    }

    /// Update the last activity timestamp for a session (e.g., when new messages arrive).
    pub fn update_last_activity_at(&mut self, session_id: Uuid, ts: i64) -> Option<()> {
        let entity = *self.session_index.get(&session_id)?;
        let mut session = self.world.get::<&mut SessionComponent>(entity).ok()?;
        if ts > session.last_activity_at {
            session.last_activity_at = ts;
        }
        Some(())
    }

    // === File Upsert / Despawn (WP-10: File Browser) ===

    /// Insert or update a file entity for a session.
    ///
    /// If a FileComponent with the same session_id + path already exists,
    /// update its modified timestamp and size. Otherwise spawn a new entity.
    pub fn upsert_file(&mut self, session_id: Uuid, path: &str, size: u64, timestamp: i64) {
        let session_id = self.resolve_alias(session_id);

        // Check if entity already exists for this path
        if let Some(entities) = self.file_index.get(&session_id) {
            for &entity in entities {
                if let Ok(mut file) = self.world.get::<&mut FileComponent>(entity)
                    && file.path == path
                {
                    file.modified = timestamp;
                    file.size = size;
                    return;
                }
            }
        }

        // Not found — spawn new entity
        self.spawn_file(FileComponent {
            id: Uuid::new_v4(),
            session_id,
            path: path.to_string(),
            modified: timestamp,
            size,
        });
    }

    /// Remove a file entity by session ID and path (e.g., when a file is deleted).
    pub fn despawn_file_by_path(&mut self, session_id: Uuid, path: &str) {
        let session_id = self.resolve_alias(session_id);

        if let Some(entities) = self.file_index.get_mut(&session_id) {
            let mut to_remove = None;
            for (idx, &entity) in entities.iter().enumerate() {
                if let Ok(file) = self.world.get::<&FileComponent>(entity)
                    && file.path == path
                {
                    to_remove = Some((idx, entity));
                    break;
                }
            }
            if let Some((idx, entity)) = to_remove {
                entities.remove(idx);
                let _ = self.world.despawn(entity);
            }
        }

        // Also remove any ClaudeEditing marker for this file
        self.clear_claude_editing(session_id, path);
    }

    /// Mark a file as being edited by Claude (eBPF PID attribution).
    pub fn set_claude_editing(&mut self, session_id: Uuid, path: &str, pid: u32) {
        let session_id = self.resolve_alias(session_id);

        // Check if already marked (immutable query is fine for existence check)
        {
            let mut query = self.world.query::<&ClaudeEditingComponent>();
            for editing in query.iter() {
                if editing.session_id == session_id && editing.file_path == path {
                    return; // Already marked
                }
            }
        }

        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        self.world.spawn((ClaudeEditingComponent {
            file_path: path.to_string(),
            session_id,
            pid,
            started_at: ts,
        },));
    }

    /// Clear the Claude editing marker for a file.
    pub fn clear_claude_editing(&mut self, session_id: Uuid, path: &str) {
        let session_id = self.resolve_alias(session_id);

        // Collect entities to despawn
        let mut to_despawn = Vec::new();
        for entity_ref in self.world.iter() {
            if let Some(editing) = entity_ref.get::<&ClaudeEditingComponent>()
                && editing.session_id == session_id
                && editing.file_path == path
            {
                to_despawn.push(entity_ref.entity());
            }
        }
        for entity in to_despawn {
            let _ = self.world.despawn(entity);
        }
    }

    /// Check if Claude is currently editing a file. Returns the PID if active.
    pub fn is_claude_editing(&self, session_id: Uuid, path: &str) -> Option<u32> {
        let session_id = self.resolve_alias(session_id);

        let mut query = self.world.query::<&ClaudeEditingComponent>();
        for editing in query.iter() {
            if editing.session_id == session_id && editing.file_path == path {
                return Some(editing.pid);
            }
        }
        None
    }

    // === Cache Meta ===

    /// Spawn or update a CacheMetaComponent for a session.
    pub fn upsert_cache_meta(&mut self, meta: CacheMetaComponent) {
        let session_id = meta.session_id;
        if let Some(&entity) = self.cache_meta_index.get(&session_id)
            && let Ok(mut existing) = self.world.get::<&mut CacheMetaComponent>(entity)
        {
            existing.file_offset = meta.file_offset;
            existing.file_size = meta.file_size;
            existing.last_refreshed = meta.last_refreshed;
            existing.message_count = meta.message_count;
            existing.is_warm = meta.is_warm;
            return;
        }
        let entity = self.world.spawn((meta,));
        self.cache_meta_index.insert(session_id, entity);
    }

    /// Get cache meta for a session.
    pub fn query_cache_meta(&self, session_id: Uuid) -> Option<CacheMetaComponent> {
        let entity = self.cache_meta_index.get(&session_id)?;
        self.world
            .get::<&CacheMetaComponent>(*entity)
            .ok()
            .map(|r| (*r).clone())
    }

    /// Check if a session's cache is warm.
    pub fn is_cache_warm(&self, session_id: Uuid) -> bool {
        self.query_cache_meta(session_id).is_some_and(|m| m.is_warm)
    }

    /// Invalidate cache for a session (clear all messages and meta).
    pub fn invalidate_cache(&mut self, session_id: Uuid) {
        // Remove all message entities for this session
        if let Some(entities) = self.message_index.remove(&session_id) {
            for entity in entities {
                let _ = self.world.despawn(entity);
            }
        }
        // Remove cache meta
        if let Some(entity) = self.cache_meta_index.remove(&session_id) {
            let _ = self.world.despawn(entity);
        }
    }

    /// Query messages for a session with pagination (from the end).
    /// Returns (messages, total_count, has_more).
    pub fn query_messages_range(
        &self,
        session_id: Uuid,
        offset: usize,
        limit: usize,
    ) -> (Vec<MessageComponent>, usize, bool) {
        let Some(entities) = self.message_index.get(&session_id) else {
            return (Vec::new(), 0, false);
        };
        let total = entities.len();
        // Paginate from the end (newest first by default)
        let start = total.saturating_sub(offset);
        let range_start = start.saturating_sub(limit);
        let messages: Vec<MessageComponent> = entities[range_start..start]
            .iter()
            .filter_map(|e| {
                self.world
                    .get::<&MessageComponent>(*e)
                    .ok()
                    .map(|r| (*r).clone())
            })
            .collect();
        let has_more = range_start > 0;
        (messages, total, has_more)
    }

    // === Stats ===

    pub fn session_count(&self) -> usize {
        self.session_index.len()
    }

    pub fn message_count(&self) -> usize {
        self.message_index.values().map(|v| v.len()).sum()
    }

    pub fn message_count_for_session(&self, session_id: Uuid) -> usize {
        self.message_index.get(&session_id).map_or(0, |v| v.len())
    }
}

impl Default for EcsWorld {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(id: Uuid) -> SessionComponent {
        SessionComponent {
            id,
            path: format!("/home/user/.claude/sessions/{id}"),
            status: SessionStatus::Active,
            model: Some("claude-opus-4-6".to_string()),
            started_at: 1708000000,
            last_activity_at: 1708000000,
            cost: None,
        }
    }

    fn make_message(id: Uuid, session_id: Uuid, role: MessageRole) -> MessageComponent {
        MessageComponent {
            id,
            session_id,
            role,
            content: format!("Message {id}"),
            content_blocks_json: None,
            timestamp: 1708000001,
            tokens: Some(100),
            hidden: false,
            message_type: MessageType::Text,
            model: None,
            stop_reason: None,
            input_tokens: None,
            output_tokens: None,
            cache_creation_input_tokens: None,
            cache_read_input_tokens: None,
        }
    }

    #[test]
    fn spawn_and_query_session() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        let sessions = world.query_sessions();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, sid);
        assert_eq!(sessions[0].status, SessionStatus::Active);
    }

    #[test]
    fn spawn_and_query_session_by_id() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        let found = world.query_session_by_id(sid);
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, sid);

        let not_found = world.query_session_by_id(Uuid::new_v4());
        assert!(not_found.is_none());
    }

    #[test]
    fn spawn_messages_by_session() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        world.spawn_message(make_message(Uuid::new_v4(), sid, MessageRole::User));
        world.spawn_message(make_message(Uuid::new_v4(), sid, MessageRole::Assistant));
        world.spawn_message(make_message(Uuid::new_v4(), sid, MessageRole::System));

        let messages = world.query_messages_by_session(sid);
        assert_eq!(messages.len(), 3);
        assert_eq!(world.message_count_for_session(sid), 3);
    }

    #[test]
    fn update_session_status() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        assert_eq!(
            world.query_session_by_id(sid).unwrap().status,
            SessionStatus::Active
        );

        world.update_session_status(sid, SessionStatus::Idle);
        assert_eq!(
            world.query_session_by_id(sid).unwrap().status,
            SessionStatus::Idle
        );
    }

    #[test]
    fn multiple_sessions_isolation() {
        let mut world = EcsWorld::new();

        let s1 = Uuid::new_v4();
        let s2 = Uuid::new_v4();
        let s3 = Uuid::new_v4();
        world.spawn_session(make_session(s1));
        world.spawn_session(make_session(s2));
        world.spawn_session(make_session(s3));

        world.spawn_message(make_message(Uuid::new_v4(), s1, MessageRole::User));
        world.spawn_message(make_message(Uuid::new_v4(), s1, MessageRole::Assistant));
        world.spawn_message(make_message(Uuid::new_v4(), s2, MessageRole::User));

        assert_eq!(world.session_count(), 3);
        assert_eq!(world.message_count(), 3);
        assert_eq!(world.query_messages_by_session(s1).len(), 2);
        assert_eq!(world.query_messages_by_session(s2).len(), 1);
        assert_eq!(world.query_messages_by_session(s3).len(), 0);
    }

    #[test]
    fn upsert_file_creates_new() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        world.upsert_file(sid, "src/main.rs", 1024, 1708000001);
        let files = world.query_files_by_session(sid);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[0].size, 1024);
    }

    #[test]
    fn upsert_file_updates_existing() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        world.upsert_file(sid, "src/main.rs", 1024, 1708000001);
        world.upsert_file(sid, "src/main.rs", 2048, 1708000002);

        let files = world.query_files_by_session(sid);
        assert_eq!(files.len(), 1); // Still only one entity
        assert_eq!(files[0].size, 2048);
        assert_eq!(files[0].modified, 1708000002);
    }

    #[test]
    fn despawn_file_by_path_removes() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        world.upsert_file(sid, "src/main.rs", 1024, 1708000001);
        world.upsert_file(sid, "src/lib.rs", 512, 1708000001);

        world.despawn_file_by_path(sid, "src/main.rs");

        let files = world.query_files_by_session(sid);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/lib.rs");
    }

    #[test]
    fn claude_editing_lifecycle() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        // Initially not editing
        assert!(world.is_claude_editing(sid, "src/main.rs").is_none());

        // Set editing
        world.set_claude_editing(sid, "src/main.rs", 12345);
        assert_eq!(world.is_claude_editing(sid, "src/main.rs"), Some(12345));

        // Clear editing
        world.clear_claude_editing(sid, "src/main.rs");
        assert!(world.is_claude_editing(sid, "src/main.rs").is_none());
    }

    #[test]
    fn despawn_file_clears_claude_editing() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        world.upsert_file(sid, "src/main.rs", 1024, 1708000001);
        world.set_claude_editing(sid, "src/main.rs", 12345);
        assert!(world.is_claude_editing(sid, "src/main.rs").is_some());

        // Despawn file should also clear editing marker
        world.despawn_file_by_path(sid, "src/main.rs");
        assert!(world.is_claude_editing(sid, "src/main.rs").is_none());
    }

    #[test]
    fn spawn_all_component_types() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));

        world.spawn_file(FileComponent {
            id: Uuid::new_v4(),
            session_id: sid,
            path: "/work/noaide/src/main.rs".to_string(),
            modified: 1708000002,
            size: 1024,
        });

        world.spawn_task(TaskComponent {
            id: Uuid::new_v4(),
            session_id: sid,
            subject: "Fix bug".to_string(),
            status: "pending".to_string(),
            owner: None,
        });

        world.spawn_agent(AgentComponent {
            id: Uuid::new_v4(),
            session_id: sid,
            name: "researcher".to_string(),
            agent_type: "Explore".to_string(),
            parent_id: None,
        });

        world.spawn_api_request(ApiRequestComponent {
            id: Uuid::new_v4(),
            session_id: sid,
            method: "POST".to_string(),
            url: "https://api.anthropic.com/v1/messages".to_string(),
            request_body: None,
            response_body: None,
            status_code: Some(200),
            latency_ms: Some(1500),
            timestamp: 1708000003,
            request_headers: None,
            response_headers: None,
            request_size: None,
            response_size: None,
            traffic_category: None,
        });

        assert_eq!(world.query_files_by_session(sid).len(), 1);
        assert_eq!(world.query_tasks_by_session(sid).len(), 1);
        assert_eq!(world.query_agents_by_session(sid).len(), 1);
        assert_eq!(world.query_api_requests_by_session(sid).len(), 1);
    }
}
