# Architecture

noaide is a Rust backend that watches AI coding agents on disk and
streams their state to a SolidJS browser UI over WebTransport.

This document fills in the components, their responsibilities, and how
data moves between them. The README points here for the operator-side
overview; everything below is the engineer-side reference.

## Three-panel UI layout

```
 Session        Chat / Editor / Network / Teams             Files
 Sidebar        (tabbed center panel)                       & Tools

 ┌─────────┬──────────────────────────────────────┬────────────────┐
 │         │                                      │                │
 │  ● Sess │  user                                │  project/      │
 │    Proj │  > Fix the auth bug in login.ts      │  ├── src/      │
 │    4.5  │                                      │  │   ├── ...   │
 │    12m  │  assistant                    ◉ 4.5  │  │   └── ...   │
 │         │  I'll fix the authentication bug.    │  ├── tests/    │
 │  ○ Sess │  Let me read the file first.         │  └── ...       │
 │    Proj │                                      │                │
 │    4.5  │  ┌─ Read login.ts ──────────────┐    │ ────────────── │
 │    1h   │  │  export function login() {   │    │                │
 │         │  │    const token = getToken(); │    │  Token Budget  │
 │  ◌ Arch │  │    ...                       │    │  ████████░░░   │
 │    Proj │  └──────────────────────────────┘    │  45k / 200k    │
 │         │                                      │                │
 │         │  ┌─ Edit login.ts ──────────────┐    │  Model         │
 │         │  │  - const token = getToken(); │    │  claude-4.5    │
 │         │  │  + const token = await       │    │                │
 │         │  │  +   getToken(credentials);  │    │  Cost          │
 │         │  └──────────────────────────────┘    │  $0.42         │
 │         │                                      │                │
 │         │  ┌─ system-reminder ────────────┐    │                │
 │  [+ New │  │  SessionStart hook success   │    │                │
 │ Session]│  └──────────────────────────────┘    │                │
 │         │                                      │                │
 │         │  ▌                              ◉    │                │
 ├─────────┴──────────────────────────────────────┴────────────────┤
 │ [Chat] [Files] [Network] [Teams] [Tasks] [Settings]  Cmd+K     │
 └─────────────────────────────────────────────────────────────────┘
```

<sup>Three resizable panels. Left: session list with breathing orbs. Center: tabbed views (chat, editor, network, teams). Right: file tree, token budget, model info. Bottom bar for quick navigation and command palette.</sup>

## High-level data-flow diagram

```
                  ┌─────────────────────────────────────────────────┐
                  │            Browser  (SolidJS + WASM)            │
                  │                                                 │
                  │  Chat ─── Editor ─── Network ─── Teams ─── Gantt│
                  │    │         │          │          │         │   │
                  │    └─────────┴──────────┴──────────┴─────────┘   │
                  │                      │                           │
                  │          WebTransport Client (codec.ts)          │
                  └──────────────────────┬──────────────────────────┘
                                         │
                                         │
                  ┌──────────────────────┴──────────────────────────┐
                  │             Rust Server  (tokio + io_uring)     │
                  │                                                 │
                  │  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
                  │  │eBPF Watcher│  │JSONL Parser│  │PTY Session│ │
                  │  │ PID attrib.│  │ streaming  │  │ mgr + tmux│ │
                  │  └─────┬──────┘  └─────┬──────┘  └─────┬─────┘ │
                  │        │               │               │       │
                  │        └───────────────┼───────────────┘       │
                  │                        │                       │
                  │              ┌─────────┴─────────┐             │
                  │              │  Zenoh Event Bus   │             │
                  │              │  SHM (~1us)        │             │
                  │              └─────────┬─────────┘             │
                  │                        │                       │
                  │         ┌──────────────┼──────────────┐        │
                  │         │              │              │        │
                  │    ┌────┴────┐   ┌─────┴─────┐  ┌────┴─────┐  │
                  │    │hecs ECS │   │ Limbo DB  │  │API Proxy │  │
                  │    │  SoA    │   │ io_uring  │  │ redaction│  │
                  │    │  state  │   │ FTS5      │  │ logging  │  │
                  │    └─────────┘   └───────────┘  └──────────┘  │
                  └─────────────────────────────────────────────────┘

  Data flow:  File Change ──▸ Watcher ──▸ Parser ──▸ ECS ──▸ Bus ──▸ Transport ──▸ Browser
  Input flow: Browser ──▸ WebTransport ──▸ Session Manager ──▸ PTY stdin / tmux send-keys
  Proxy flow: Claude Code ──▸ ANTHROPIC_BASE_URL ──▸ Proxy ──▸ api.anthropic.com
```

## Tech stack

<table>
<tr><th align="left">Layer</th><th align="left">Choice</th><th align="left">Rationale</th></tr>
<tr><td><b>Backend</b></td><td>Rust + tokio + io_uring</td><td>Zero-cost abstractions, memory safety, async I/O</td></tr>
<tr><td><b>Frontend</b></td><td>SolidJS + Vite 6</td><td>Fine-grained reactivity without Virtual DOM overhead</td></tr>
<tr><td><b>Transport</b></td><td>WebTransport (HTTP/3, QUIC)</td><td>0-RTT reconnect, multiplexed streams, connection migration. Requires a Chromium-based browser. Production deployment is documented in <a href="adr/001-production-deployment.md">ADR-001</a>.</td></tr>
<tr><td><b>State</b></td><td>hecs ECS (struct-of-arrays)</td><td>Cache-friendly iteration over 100+ concurrent entities</td></tr>
<tr><td><b>Database</b></td><td>Limbo (async SQLite, io_uring)</td><td>FTS5 full-text search, JSONL remains source of truth</td></tr>
<tr><td><b>File Watch</b></td><td>eBPF via aya</td><td>Kernel-level PID attribution for conflict detection</td></tr>
<tr><td><b>Event Bus</b></td><td>Zenoh + shared memory</td><td>~1us inter-component latency, zero-copy IPC</td></tr>
<tr><td><b>Editor</b></td><td>CodeMirror 6</td><td>500 KB (vs Monaco 5 MB), built-in MergeView</td></tr>
<tr><td><b>Wire Format</b></td><td>FlatBuffers + MessagePack + Zstd</td><td>Zero-copy hot path, flexible cold path, ~70% compression</td></tr>
<tr><td><b>WASM</b></td><td>jsonl-parser, markdown, compress</td><td>Off-main-thread heavy computation via Web Workers</td></tr>
<tr><td><b>Theme</b></td><td>Catppuccin Mocha</td><td>14 harmonious dark colors, community standard</td></tr>
</table>

Architectural decisions are documented as [11 ADRs in llms.txt](../llms.txt). Each records the context, decision, alternatives considered, and trade-offs accepted.

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

## Configuration reference

<details>
<summary><b>Environment variables</b></summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `NOAIDE_PORT` | `4433` | WebTransport/QUIC port |
| `NOAIDE_HTTP_PORT` | `8080` | HTTP port (health endpoint, API proxy) |
| `NOAIDE_DB_PATH` | `./data/noaide/ide.db` | Limbo database path |
| `NOAIDE_WATCH_PATHS` | `~/.claude/` | Directories to watch for JSONL changes |
| `NOAIDE_TLS_CERT` | `./certs/cert.pem` | TLS certificate path |
| `NOAIDE_TLS_KEY` | `./certs/key.pem` | TLS private key path |
| `NOAIDE_LOG_LEVEL` | `info` | Log verbosity (trace/debug/info/warn/error) |

</details>

<details>
<summary><b>Feature flags</b></summary>

| Flag | Default | Description |
|------|---------|-------------|
| `ENABLE_EBPF` | `true` | eBPF file watching (false = inotify fallback) |
| `ENABLE_SHM` | `true` | Zenoh shared memory (false = TCP transport) |
| `ENABLE_WASM_PARSER` | `true` | WASM JSONL parser (false = JavaScript fallback) |
| `ENABLE_API_PROXY` | `true` | Anthropic API proxy and Network tab |
| `ENABLE_PROFILER` | `false` | Performance profiler panel |
| `ENABLE_AUDIO` | `false` | UI notification sounds |

</details>

## Development workflow

```bash
# ── Backend ──────────────────────────────────
cargo build                              # dev build
cargo test                               # unit + integration tests
cargo clippy -- -D warnings              # lint
cargo bench                              # performance benchmarks

# ── Frontend ─────────────────────────────────
cd frontend
pnpm dev                                 # Vite dev server with HMR
pnpm build                               # production build
pnpm lint                                # ESLint

# ── WASM ─────────────────────────────────────
wasm-pack build wasm/jsonl-parser --target web
wasm-pack build wasm/markdown --target web
wasm-pack build wasm/compress --target web

# ── FlatBuffers ──────────────────────────────
flatc --rust --ts -o generated/ schemas/messages.fbs
```

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for branch conventions,
commit style, and PR process. See [`../TESTING.md`](../TESTING.md) for
the full test gate matrix and benchmark commands.

## Feature → source map

Each row points to the primary module that implements it, so the
description is easy to cross-check against the code.

| Feature | Source | Description |
|---------|--------|-------------|
| **Message Cache** | [`server/src/cache/mod.rs`](../server/src/cache/mod.rs) | ECS-backed in-memory cache with incremental JSONL parsing. Designed for <5 ms cached responses (see [performance.md](performance.md)). |
| **Pagination** | [`server/src/cache/mod.rs`](../server/src/cache/mod.rs) + [`VirtualScroller.tsx`](../frontend/src/components/chat/VirtualScroller.tsx) | Infinite scroll with scroll-anchor preservation. Loads 200 messages at a time. |
| **Thinking Blocks** | [`components/chat/ThinkingBlock.tsx`](../frontend/src/components/chat/ThinkingBlock.tsx) | Animated collapse/expand with measured `scrollHeight`. Token count estimate. |
| **Session Pinning** | [`stores/session.ts`](../frontend/src/stores/session.ts) + [`components/sessions/SessionList.tsx`](../frontend/src/components/sessions/SessionList.tsx) | Star sessions, sorted pinned-first. Persisted in localStorage. |
| **Profiler Metrics** | [`components/profiler/ProfilerPanel.tsx`](../frontend/src/components/profiler/ProfilerPanel.tsx) | Real-time FPS, heap usage, events/sec, render time, DOM nodes, transport RTT. |
| **Command Palette** | [`components/shared/CommandPalette.tsx`](../frontend/src/components/shared/CommandPalette.tsx) | Cmd+K with scope prefixes (`>` commands, `#` sessions, `@` tabs). Fuzzy matching with highlights. |
| **Session Search** | [`components/chat/SearchBar.tsx`](../frontend/src/components/chat/SearchBar.tsx) | Cmd+F in-chat search with match counter and prev/next navigation. |
| **Notifications** | [`lib/notifications.ts`](../frontend/src/lib/notifications.ts) | Toasts, Browser Notification API, optional Web Audio cues (gated by `ENABLE_AUDIO`). |
| **Cost Dashboard** | [`components/cost/CostDashboard.tsx`](../frontend/src/components/cost/CostDashboard.tsx) | Per-model token breakdown, cost bars, session ranking, input/output/cache ratios. |
| **Export** | [`lib/export.ts`](../frontend/src/lib/export.ts) + [`components/shared/ExportDialog.tsx`](../frontend/src/components/shared/ExportDialog.tsx) | Markdown, JSON, or HTML export with configurable options. Mobile Web Share API support. |
| **Session Stats API** | [`server/src/main.rs`](../server/src/main.rs) | HTTP endpoint with token counts, model breakdown, duration. |
| **Subagent Tree** | [`components/teams/SubagentTree.tsx`](../frontend/src/components/teams/SubagentTree.tsx) | Tree visualization of `agentId`/`parentUuid` hierarchies in the Teams panel. |

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Open command palette |
| `Cmd/Ctrl + F` | Search in chat |
| `Cmd/Ctrl + 1-8` | Switch tabs (Chat, Network, Teams, Gallery, Tasks, Git, Cost, Settings) |
| `Escape` | Close overlay / search |
| `Tab` (in palette) | Cycle scope prefixes |

## Related docs

- [README](../README.md) — operator-facing overview
- [AGENTS.md](../AGENTS.md) — supervisor contract
- [llms.txt](../llms.txt) — the 11 ADRs behind these choices
- [api.md](api.md) — HTTP endpoint reference
