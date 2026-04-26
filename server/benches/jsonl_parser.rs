//! Benchmarks for the JSONL parser hot path.
//!
//! Closes part of #142. The parse rate quoted in the README as a
//! design goal (>10k lines/s) is measured here.
//!
//! Run with: `cargo bench -p noaide-server --bench jsonl_parser`

use std::hint::black_box;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use noaide_server::parser::parse_line;

const REALISTIC_USER_MESSAGE: &str = r#"{"parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/work/noaide","sessionId":"abc-123","version":"1.0.0","gitBranch":"main","type":"user","message":{"role":"user","content":"Help me fix the auth bug in login.ts"},"uuid":"01H8XYZ","timestamp":"2026-04-26T08:00:00.000Z"}"#;

const REALISTIC_ASSISTANT_MESSAGE: &str = r#"{"parentUuid":"01H8XYZ","isSidechain":false,"userType":"external","cwd":"/work/noaide","sessionId":"abc-123","version":"1.0.0","gitBranch":"main","type":"assistant","message":{"id":"msg_01","model":"claude-sonnet-4-5-20250929","role":"assistant","content":[{"type":"text","text":"I'll fix the authentication bug. Let me read the file first to understand the current state."}],"stop_reason":"end_turn","usage":{"input_tokens":1500,"cache_creation_input_tokens":0,"cache_read_input_tokens":12000,"output_tokens":120}},"uuid":"01H8AAA","timestamp":"2026-04-26T08:00:01.000Z"}"#;

const REALISTIC_TOOL_USE_MESSAGE: &str = r#"{"parentUuid":"01H8AAA","isSidechain":false,"userType":"external","cwd":"/work/noaide","sessionId":"abc-123","version":"1.0.0","gitBranch":"main","type":"assistant","message":{"id":"msg_02","model":"claude-sonnet-4-5-20250929","role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"Read","input":{"file_path":"/work/noaide/frontend/src/login.ts"}}],"stop_reason":"tool_use"},"uuid":"01H8BBB","timestamp":"2026-04-26T08:00:02.000Z"}"#;

const REALISTIC_THINKING_MESSAGE: &str = r#"{"parentUuid":"01H8BBB","isSidechain":false,"userType":"external","cwd":"/work/noaide","sessionId":"abc-123","version":"1.0.0","gitBranch":"main","type":"assistant","message":{"id":"msg_03","model":"claude-sonnet-4-5-20250929","role":"assistant","content":[{"type":"thinking","thinking":"The user wants to fix auth. Let me trace through getToken first to understand the flow before making changes. I should read login.ts then check if there are tests that already exercise this path."}]},"uuid":"01H8CCC","timestamp":"2026-04-26T08:00:03.000Z"}"#;

fn bench_parse_line(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_line");

    // Throughput in bytes per iteration so the report includes MB/s.
    let cases: &[(&str, &str)] = &[
        ("user_message", REALISTIC_USER_MESSAGE),
        ("assistant_message", REALISTIC_ASSISTANT_MESSAGE),
        ("tool_use_message", REALISTIC_TOOL_USE_MESSAGE),
        ("thinking_message", REALISTIC_THINKING_MESSAGE),
    ];

    for (label, line) in cases {
        group.throughput(Throughput::Bytes(line.len() as u64));
        group.bench_function(*label, |b| {
            b.iter(|| {
                let msg = parse_line(black_box(line)).expect("valid JSONL line");
                black_box(msg);
            });
        });
    }

    group.finish();
}

fn bench_parse_line_mixed_workload(c: &mut Criterion) {
    // Simulate a real session: user message, then a few assistant
    // turns with tool use and thinking. This is closer to the cache
    // warm path which calls parse_line for every line in a JSONL file.
    let mixed: Vec<&str> = vec![
        REALISTIC_USER_MESSAGE,
        REALISTIC_ASSISTANT_MESSAGE,
        REALISTIC_TOOL_USE_MESSAGE,
        REALISTIC_THINKING_MESSAGE,
        REALISTIC_ASSISTANT_MESSAGE,
    ];
    let total_bytes: u64 = mixed.iter().map(|s| s.len() as u64).sum();

    let mut group = c.benchmark_group("parse_line_mixed");
    group.throughput(Throughput::Bytes(total_bytes));
    group.bench_function("five_line_session", |b| {
        b.iter(|| {
            for line in &mixed {
                let m = parse_line(black_box(line)).expect("valid JSONL line");
                black_box(m);
            }
        });
    });
    group.finish();
}

criterion_group!(benches, bench_parse_line, bench_parse_line_mixed_workload);
criterion_main!(benches);
