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
        }
    }

    /// Create a thread-safe shared handle.
    pub fn shared(self) -> SharedEcsWorld {
        Arc::new(RwLock::new(self))
    }

    // === Spawn ===

    pub fn spawn_session(&mut self, session: SessionComponent) -> Entity {
        let id = session.id;
        let entity = self.world.spawn((session,));
        self.session_index.insert(id, entity);
        entity
    }

    pub fn spawn_message(&mut self, msg: MessageComponent) -> Entity {
        let session_id = msg.session_id;
        let entity = self.world.spawn((msg,));
        self.message_index
            .entry(session_id)
            .or_default()
            .push(entity);
        entity
    }

    pub fn spawn_file(&mut self, file: FileComponent) -> Entity {
        let session_id = file.session_id;
        let entity = self.world.spawn((file,));
        self.file_index.entry(session_id).or_default().push(entity);
        entity
    }

    pub fn spawn_task(&mut self, task: TaskComponent) -> Entity {
        let session_id = task.session_id;
        let entity = self.world.spawn((task,));
        self.task_index.entry(session_id).or_default().push(entity);
        entity
    }

    pub fn spawn_agent(&mut self, agent: AgentComponent) -> Entity {
        let session_id = agent.session_id;
        let entity = self.world.spawn((agent,));
        self.agent_index.entry(session_id).or_default().push(entity);
        entity
    }

    pub fn spawn_api_request(&mut self, req: ApiRequestComponent) -> Entity {
        let session_id = req.session_id;
        let entity = self.world.spawn((req,));
        self.api_request_index
            .entry(session_id)
            .or_default()
            .push(entity);
        entity
    }

    // === Query (returns cloned data — hecs::Ref cannot escape borrow) ===

    pub fn query_sessions(&self) -> Vec<SessionComponent> {
        let mut query = self.world.query::<&SessionComponent>();
        query.iter().map(|(_, s)| (*s).clone()).collect()
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
            cost: None,
        }
    }

    fn make_message(id: Uuid, session_id: Uuid, role: MessageRole) -> MessageComponent {
        MessageComponent {
            id,
            session_id,
            role,
            content: format!("Message {id}"),
            timestamp: 1708000001,
            tokens: Some(100),
            hidden: false,
            message_type: MessageType::Text,
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
        });

        assert_eq!(world.query_files_by_session(sid).len(), 1);
        assert_eq!(world.query_tasks_by_session(sid).len(), 1);
        assert_eq!(world.query_agents_by_session(sid).len(), 1);
        assert_eq!(world.query_api_requests_by_session(sid).len(), 1);
    }
}
