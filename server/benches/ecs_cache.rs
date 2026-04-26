//! Benchmarks for the ECS cache → API JSON hot path.
//!
//! Closes part of #142. The "<5ms cached message fetch" design goal
//! quoted in the README depends on this conversion being fast.
//!
//! Run with: `cargo bench -p noaide-server --bench ecs_cache`

use std::hint::black_box;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use noaide_server::cache::component_to_api_json;
use noaide_server::ecs::components::{MessageComponent, MessageRole, MessageType};
use uuid::Uuid;

fn make_text_message() -> MessageComponent {
    MessageComponent {
        id: Uuid::new_v4(),
        session_id: Uuid::new_v4(),
        role: MessageRole::Assistant,
        content: "I'll fix the authentication bug. Let me read the file first \
                  to understand the current state, then make targeted edits."
            .to_string(),
        content_blocks_json: None,
        timestamp: 1714000000000,
        tokens: Some(120),
        hidden: false,
        message_type: MessageType::Text,
        model: Some("claude-sonnet-4-5-20250929".to_string()),
        stop_reason: Some("end_turn".to_string()),
        input_tokens: Some(1500),
        output_tokens: Some(120),
        cache_creation_input_tokens: Some(0),
        cache_read_input_tokens: Some(12000),
    }
}

fn make_tool_use_message() -> MessageComponent {
    let blocks = serde_json::json!([
        {
            "type": "tool_use",
            "id": "toolu_01",
            "name": "Read",
            "input": {"file_path": "/work/noaide/frontend/src/login.ts"}
        }
    ]);
    MessageComponent {
        id: Uuid::new_v4(),
        session_id: Uuid::new_v4(),
        role: MessageRole::Assistant,
        content: String::new(),
        content_blocks_json: Some(blocks.to_string()),
        timestamp: 1714000001000,
        tokens: Some(40),
        hidden: false,
        message_type: MessageType::ToolUse,
        model: Some("claude-sonnet-4-5-20250929".to_string()),
        stop_reason: Some("tool_use".to_string()),
        input_tokens: Some(1620),
        output_tokens: Some(40),
        cache_creation_input_tokens: Some(0),
        cache_read_input_tokens: Some(12120),
    }
}

fn make_user_message() -> MessageComponent {
    MessageComponent {
        id: Uuid::new_v4(),
        session_id: Uuid::new_v4(),
        role: MessageRole::User,
        content: "Help me fix the auth bug in login.ts".to_string(),
        content_blocks_json: None,
        timestamp: 1714000000000,
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

fn bench_component_to_api_json(c: &mut Criterion) {
    let mut group = c.benchmark_group("component_to_api_json");

    let user = make_user_message();
    let assistant = make_text_message();
    let tool_use = make_tool_use_message();

    group.bench_function("user_text", |b| {
        b.iter(|| {
            let json = component_to_api_json(black_box(&user));
            black_box(json);
        });
    });
    group.bench_function("assistant_text", |b| {
        b.iter(|| {
            let json = component_to_api_json(black_box(&assistant));
            black_box(json);
        });
    });
    group.bench_function("tool_use", |b| {
        b.iter(|| {
            let json = component_to_api_json(black_box(&tool_use));
            black_box(json);
        });
    });

    group.finish();
}

fn bench_pagination_window(c: &mut Criterion) {
    // Simulate the API endpoint that returns a 200-message page —
    // the most common cache-fetch shape.
    let messages: Vec<MessageComponent> = (0..200)
        .map(|i| {
            if i % 3 == 0 {
                make_user_message()
            } else if i % 3 == 1 {
                make_text_message()
            } else {
                make_tool_use_message()
            }
        })
        .collect();

    let mut group = c.benchmark_group("pagination_window");
    group.throughput(Throughput::Elements(messages.len() as u64));
    group.bench_function("200_message_page", |b| {
        b.iter(|| {
            let out: Vec<serde_json::Value> = messages.iter().map(component_to_api_json).collect();
            black_box(out);
        });
    });
    group.finish();
}

criterion_group!(
    benches,
    bench_component_to_api_json,
    bench_pagination_window
);
criterion_main!(benches);
