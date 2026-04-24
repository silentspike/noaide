# Architecture

noaide is a Rust backend that watches AI coding agents on disk and
streams their state to a SolidJS browser UI over WebTransport.

The high-level picture is in the [README](../README.md#architecture).
This document fills in the components, their responsibilities, and how
data moves between them.

## Components

### File watcher (`server/src/watcher/`)

Observes the agent's home directory (`~/.claude/`, `~/.gemini/`,
`~/.codex/`) for file creations, writes, and deletions. eBPF
(`ebpf.rs`) is the primary backend because it carries the writing PID,
which the UI uses to distinguish "you wrote this" from "the agent wrote
this". An inotify fallback (`fallback.rs`) activates when eBPF is not
available (missing capabilities, unsupported kernel).

### JSONL parser (`server/src/parser/`)

Streaming parser for agent conversation logs. Maintains per-session
byte offsets so each new line triggers incremental work: parse → emit
event. Handles three variants (Claude Code, Gemini CLI, Codex) via
pluggable format adapters. JSONL is the source of truth; the DB and
ECS state are regeneratable caches.

### Session discovery (`server/src/discovery/`)

Scans agent home directories at startup and on filesystem change to
build the initial session list. Provides the mapping from on-disk
paths to session IDs that other components reference.

### Session manager (`server/src/session/`)

Two modes:

- **Managed** (`managed.rs`) — noaide owns the PTY, spawns the agent as
  a child process, and can kill or restart it.
- **Observed** (`observed.rs`) — the agent runs anywhere. noaide
  attaches input using `tmux send-keys` to the agent's existing pane.

Both modes surface the same session API to the rest of the server.

### ECS state engine (`server/src/ecs/`)

In-memory state built on [`hecs`](https://docs.rs/hecs). Components
for sessions, messages, files, tasks, and agents live in
struct-of-arrays storage (cache-friendly iteration). Systems are
functions that run per event — they read components, compute
derivations, and write the results back. This is where the hot loop
lives.

### Limbo database (`server/src/db/`)

Async SQLite via [Limbo](https://github.com/tursodatabase/limbo). Used
as an index and cache for fast queries and full-text search (FTS5
feature-gated with `index_experimental`). Schema in `schema.rs`,
queries in `queries.rs`. If the DB is lost, it can be rebuilt from the
JSONL files.

### Event bus (`server/src/bus/`)

[Zenoh](https://zenoh.io/) with shared-memory transport for
inter-component messaging. Targets ~1 µs publish latency within a
process. Every message on the bus is wrapped in an `EventEnvelope`
(see `types.rs` in the ECS module) carrying a Lamport clock, source,
session ID, and deduplication key.

### Transport (`server/src/transport/`)

WebTransport (HTTP/3 QUIC) server implemented over
[`wtransport`](https://docs.rs/wtransport). Multiplexes streams over
a single TLS 1.3 connection. Adaptive quality tier:

| Tier | RTT bucket | Target rate |
|------|-----------|-------------|
| 120 Hz | < 50 ms | hot-path frames each vsync |
| 30 Hz  | 50–150 ms | throttled hot path |
| 10 Hz  | > 150 ms | heavy throttle, batch cold path |

Hot-path frames use FlatBuffers for zero-copy decoding in the browser.
Cold-path frames (file tree, git state, session list) use MessagePack.
Both paths are Zstd-compressed.

### API proxy (`server/src/proxy/`)

Per-session reverse proxy at `/s/{session}/...`. Intercepts API calls
the agent makes (Anthropic, Gemini, Codex upstreams) and records them
so the Network tab can show the request/response pair. Secrets are
redacted on the way through. The proxy can also hold requests in
"manual mode" — nothing forwards until the supervisor approves.

### Git integration (`server/src/git/`)

Wraps [`git2`](https://docs.rs/git2) to expose branches, status, diff,
stage/unstage, commit, blame, and log to the browser. Called directly
by HTTP handlers, not on the bus.

### Teams (`server/src/teams/`)

Derives the agent hierarchy (parent/child sub-agents) from JSONL
`agentId`/`parentUuid` fields and serves it to the Teams panel for the
topology graph and swimlane views.

## Data flow

Three flows dominate the request/response pattern.

### 1. File change → browser

```
inode write ──▸ eBPF program (bpf/noaide.bpf.c)
               │  PID, path, event type
               ▼
           watcher::ebpf::RingBuf consumer
               ▼
           Event { source: Watcher, ... }  published on zenoh topic
               ▼
           ECS system handler — updates File component
               ▼
           transport adapts to RTT tier — serializes (FlatBuffers + Zstd)
               ▼
           browser WebTransport client — decodes — SolidJS signal update
```

Target end-to-end latency: < 50 ms p99 (a design goal; see
[issue #142](https://github.com/silentspike/noaide/issues/142)).

### 2. Browser input → agent

```
browser typed input ──▸ fetch POST /api/sessions/{id}/input
                       ▼
                   Axum handler → session_manager.send_input()
                       ▼
                   Managed PTY write  OR  tmux send-keys
                       ▼
                   Agent process reads on stdin
                       ▼
                   Agent writes to JSONL + stdout
                       ▼
                   (loop back through flow 1)
```

### 3. Agent API call → supervisor visibility

```
Agent process                noaide proxy                    upstream (e.g. api.anthropic.com)
      │                            │                                  │
      ├── POST /s/{uuid}/v1/... ─▶ │                                  │
      │                            ├─ redact + record request         │
      │                            ├─ gate (auto/manual) ────────────▶│
      │                            │                                  │
      │                            │◀────── streamed SSE response ────┤
      │◀────── forwarded ──────────┤                                  │
      │                            ├─ record response                 │
      │                            ▼                                  │
      │                       Network tab event on the bus
```

## Wire format

- **Hot path**: FlatBuffers schema in
  [`schemas/messages.fbs`](../schemas/messages.fbs). Decoded
  zero-copy in the browser (`frontend/src/transport/codec.ts`).
- **Cold path**: MessagePack frames carrying SessionList, FileTree,
  GitState, TeamTopology.
- **Compression**: Both paths are Zstd-framed. WASM decoder in
  `wasm/compress/` lifts the payload on the browser side.

## Threading and concurrency

The server runs on a multi-threaded `tokio` runtime (workers = CPU
count). Hot components (watcher, parser, ECS update, transport
serializer) are pinned to bounded channels so backpressure is
explicit — when the transport is slow, the channel fills and older
`file.change` events drop oldest-first. `message.new` is a never-drop
channel because losing a message is worse than latency.

## Related docs

- [README — Architecture diagram](../README.md#architecture)
- [AGENTS.md](../AGENTS.md) — supervisor contract
- [llms.txt](../llms.txt) — the 11 ADRs behind these choices
- [api.md](api.md) — HTTP endpoint reference
