use uuid::Uuid;

use super::components::SessionStatus;
use super::world::EcsWorld;

/// Track session status based on message activity.
///
/// Sessions with messages in the last `idle_threshold_secs` are Active,
/// otherwise Idle. This is a simple heuristic; the JSONL parser and
/// PTY watcher provide more accurate signals.
pub fn track_session_status(world: &mut EcsWorld, now: i64, idle_threshold_secs: i64) {
    let sessions: Vec<Uuid> = world.query_sessions().iter().map(|s| s.id).collect();

    for session_id in sessions {
        let latest_ts = world
            .query_messages_by_session(session_id)
            .iter()
            .map(|m| m.timestamp)
            .max()
            .unwrap_or(0);

        let current_status = world
            .query_session_by_id(session_id)
            .map(|s| s.status)
            .unwrap_or_default();

        // Don't override Error or Archived states
        if current_status == SessionStatus::Error || current_status == SessionStatus::Archived {
            continue;
        }

        let new_status = if latest_ts > 0 && (now - latest_ts) < idle_threshold_secs {
            SessionStatus::Active
        } else {
            SessionStatus::Idle
        };

        if current_status != new_status {
            world.update_session_status(session_id, new_status);
        }
    }
}

/// Session statistics for dashboard display.
pub struct SessionStats {
    pub total_sessions: usize,
    pub active_sessions: usize,
    pub total_messages: usize,
}

/// Collect session statistics from the ECS world.
pub fn collect_session_stats(world: &EcsWorld) -> SessionStats {
    let sessions = world.query_sessions();
    let active = sessions
        .iter()
        .filter(|s| s.status == SessionStatus::Active)
        .count();

    SessionStats {
        total_sessions: sessions.len(),
        active_sessions: active,
        total_messages: world.message_count(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ecs::components::*;

    fn make_session(id: Uuid) -> SessionComponent {
        SessionComponent {
            id,
            path: format!("/tmp/{id}"),
            status: SessionStatus::Active,
            model: None,
            started_at: 1708000000,
            cost: None,
        }
    }

    fn make_message(session_id: Uuid, timestamp: i64) -> MessageComponent {
        MessageComponent {
            id: Uuid::new_v4(),
            session_id,
            role: MessageRole::User,
            content: "test".to_string(),
            content_blocks_json: None,
            timestamp,
            tokens: None,
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
    fn track_status_idle_when_no_recent_messages() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));
        world.spawn_message(make_message(sid, 1000));

        // now=2000, threshold=60 => message at 1000 is 1000s old => idle
        track_session_status(&mut world, 2000, 60);
        assert_eq!(
            world.query_session_by_id(sid).unwrap().status,
            SessionStatus::Idle
        );
    }

    #[test]
    fn track_status_active_when_recent_messages() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));
        world.spawn_message(make_message(sid, 1990));

        // now=2000, threshold=60 => message at 1990 is 10s old => active
        track_session_status(&mut world, 2000, 60);
        assert_eq!(
            world.query_session_by_id(sid).unwrap().status,
            SessionStatus::Active
        );
    }

    #[test]
    fn track_status_preserves_error_state() {
        let mut world = EcsWorld::new();
        let sid = Uuid::new_v4();
        world.spawn_session(make_session(sid));
        world.update_session_status(sid, SessionStatus::Error);

        track_session_status(&mut world, 2000, 60);
        assert_eq!(
            world.query_session_by_id(sid).unwrap().status,
            SessionStatus::Error
        );
    }

    #[test]
    fn collect_stats() {
        let mut world = EcsWorld::new();
        let s1 = Uuid::new_v4();
        let s2 = Uuid::new_v4();
        world.spawn_session(make_session(s1));
        world.spawn_session(make_session(s2));
        world.update_session_status(s2, SessionStatus::Idle);

        world.spawn_message(make_message(s1, 1000));
        world.spawn_message(make_message(s1, 1001));
        world.spawn_message(make_message(s2, 1002));

        let stats = collect_session_stats(&world);
        assert_eq!(stats.total_sessions, 2);
        assert_eq!(stats.active_sessions, 1);
        assert_eq!(stats.total_messages, 3);
    }
}
