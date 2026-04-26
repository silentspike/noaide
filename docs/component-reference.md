# Component Reference

> Per-module reference for the noaide workspace. For each module:
> what it owns, what it publishes on the bus, and where its
> configuration lives.
>
> Companion to [docs/architecture.md](architecture.md). That document
> shows the picture; this one is the dictionary.

## Workspace layout

```
noaide/
├── server/             # Main backend binary
│   └── src/
│       ├── bus/        # Zenoh + SHM event bus
│       ├── cache/      # ECS-backed message cache
│       ├── db/         # Limbo SQLite layer
│       ├── discovery/  # Session scanner (~/.claude, ~/.gemini, ~/.codex)
│       ├── ecs/        # hecs world (sessions, messages, files, tasks, agents)
│       ├── files/      # File-tree handlers
│       ├── git/        # libgit2 wrappers (status, diff, blame, log)
│       ├── parser/     # JSONL streaming parser (multi-format)
│       ├── plan/       # TOGAF plan.json round-trip
│       ├── proxy/      # API proxy + audit log
│       ├── session/    # PTY (managed) + tmux (observed) session manager
│       ├── teams/      # Topology + swimlane derivation
│       ├── transport/  # WebTransport (HTTP/3) frames
│       ├── watcher/    # eBPF + inotify file watcher
│       ├── lib.rs      # Workspace re-exports
│       └── main.rs     # Wiring + axum router
├── crates/
│   ├── noaide-common/  # Shared types
│   ├── noaide-ebpf/    # eBPF program (built with bpfel-unknown-none target)
│   └── togaf-parser/   # TOGAF plan format parser
├── wasm/
│   ├── compress/       # Zstd decoder for the browser
│   ├── jsonl-parser/   # Browser-side JSONL parser
│   └── markdown/       # pulldown-cmark for the browser
└── frontend/           # SolidJS UI
```

## Backend modules (`server/src/`)

### `bus`
- **Owns**: the Zenoh session, topic-name constants, `EventEnvelope` definition, Lamport-clock state.
- **Publishes**: every system-internal event. Topics defined in `topics.rs` (`session/messages`, `files/changes`, `tasks/updates`, `agents/metrics`, `system/events`).
- **Config**: `ENABLE_SHM` feature flag (true → shared-memory transport, false → TCP loopback). Bounded channel capacity in `bus/mod.rs`.

### `cache`
- **Owns**: the in-memory message cache backing `/api/sessions/{id}/messages` pagination. ECS query helpers.
- **Publishes**: nothing — pure read-side.
- **Config**: cache size constant in `cache/mod.rs` (default = unbounded; the JSONL set is small enough).

### `db`
- **Owns**: the Limbo connection, schema migrations, query functions.
- **Publishes**: nothing.
- **Config**: `NOAIDE_DB_PATH` (default `./data/noaide/ide.db`). The DB is regeneratable from JSONL.

### `discovery`
- **Owns**: the startup scanner that walks `~/.claude/projects/`, `~/.gemini/tmp/*/chats/`, `~/.codex/sessions/YYYY/MM/DD/` and registers each found session in the ECS.
- **Publishes**: `session.discovered` events on first scan; `session.added`/`session.removed` on subsequent watcher events.
- **Config**: `NOAIDE_WATCH_PATHS` (default `~/.claude/`).

### `ecs`
- **Owns**: the [`hecs`](https://docs.rs/hecs) world, all components (Session, Message, File, Task, Agent), and the systems that mutate them.
- **Publishes**: ECS-derived events back to the bus when a system writes (e.g., `messages_loaded`).
- **Config**: none — purely structural.

### `files`
- **Owns**: HTTP handlers for `/api/files`, `/api/browse`. Reads from disk on demand.
- **Publishes**: nothing.
- **Config**: none.

### `git`
- **Owns**: libgit2 wrappers for branches, status, diff, hunk-staging, commit, blame, log, PR listing (via `gh`).
- **Publishes**: nothing — handlers respond directly.
- **Config**: none. Discovers the repo from the session's project path.

### `parser`
- **Owns**: the streaming JSONL parser with byte-offset state, plus the format adapters for Claude/Gemini/Codex.
- **Publishes**: `message.new` events for each parsed line.
- **Config**: `ENABLE_WASM_PARSER` flag (frontend-side; server always uses Rust). Byte-offset cache lives in `cache`.

### `plan`
- **Owns**: TOGAF `plan.json` and `plan-edits.json` round-trip handlers.
- **Publishes**: `plan.changed` events on every edit.
- **Config**: `NOAIDE_PLAN_DIR` (default `./plans/` on production, fixture path in CI).

### `proxy`
- **Owns**: the per-session reverse proxy, intercept gate, audit log, body redaction, key rotation (AES-256-GCM).
- **Publishes**: `proxy.request_started`, `proxy.response_complete`, `proxy.intercept_pending`.
- **Config**: env vars `ANTHROPIC_BASE_URL` (legacy), upstream whitelist hard-coded, `NOAIDE_PROXY_AUDIT_RETAIN` for rotation. Listens on `:4434` by default.

### `session`
- **Owns**: PTY allocation (managed mode), tmux send-keys integration (observed mode), session lifecycle.
- **Publishes**: `session.started`, `session.ended`, `session.input_sent`.
- **Config**: agent command lists for managed-session spawn (Claude/Gemini/Codex) live in `session/managed.rs`.

### `teams`
- **Owns**: topology derivation from `agentId`/`parentUuid`, swimlane time-tracking, task board.
- **Publishes**: nothing — derived on demand by handlers.
- **Config**: none.

### `transport`
- **Owns**: the wtransport HTTP/3 server, frame codec (FlatBuffers + MessagePack + Zstd), adaptive RTT tier.
- **Publishes**: subscribes to bus topics, fans them out to connected browser clients. Does not publish back to the bus.
- **Config**: `NOAIDE_PORT` (default 4433), `NOAIDE_TLS_CERT`, `NOAIDE_TLS_KEY`. TLS is mandatory.

### `watcher`
- **Owns**: the eBPF program loader, the inotify fallback, and the PID→Source resolver.
- **Publishes**: `file.change` events with `(path, kind, source)`.
- **Config**: `ENABLE_EBPF` flag (true → eBPF first, false → inotify only). Watch paths from `NOAIDE_WATCH_PATHS`.

## Auxiliary crates (`crates/`)

### `noaide-common`
- Shared types used by both `server` and the eBPF crate.
- No bus interaction.

### `noaide-ebpf`
- The eBPF program itself. Built with `cargo +nightly build --target bpfel-unknown-none` via the `xtask` runner.
- Embedded into `server` at compile time (see `server/build.rs`).
- See [docs/security-deep-dive.md — eBPF trust model](security-deep-dive.md#ebpf-trust-model) for the load-time verifier checks.

### `togaf-parser`
- TOGAF `plan.json` schema parser (independent of `server::plan`, which uses this crate).

## WASM modules (`wasm/`)

### `jsonl-parser`
- Browser-side parser. Mirrors the server-side `parser` adapters so the frontend can render newly-streamed JSONL without a server round-trip.
- Used in `frontend/src/workers/jsonl.worker.ts`.

### `markdown`
- pulldown-cmark wrapper. Renders message bodies on a Worker thread to keep the main thread idle.
- Used in `frontend/src/components/chat/MarkdownContent.tsx` (via the worker).

### `compress`
- Zstd decoder. Decompresses the FlatBuffers and MessagePack frames sent over WebTransport.
- Used in `frontend/src/transport/codec.ts`.

All three modules are built via `wasm-pack build wasm/<name> --target web` and emitted to `frontend/src/wasm/<name>/`.

## Frontend (`frontend/src/`)

The frontend is documented per-feature in
[README.md — Features](../README.md#features). Each row of that table
points at the primary source module.

Top-level structure:

```
frontend/src/
├── App.tsx              # Layout shell + route mounting
├── components/          # SolidJS components (chat, editor, sessions, …)
├── stores/              # Signals: session, file, plan, settings
├── transport/           # WebTransport client + codec
├── workers/             # Worker entries for the WASM modules
├── hooks/               # Reusable signals (useMediaQuery, useVoiceInput, …)
├── lib/                 # Pure helpers (export, notifications, profiler-metrics)
├── types/               # TypeScript types
└── styles/              # Catppuccin Mocha tokens
```

## See also

- [docs/architecture.md](architecture.md) — components in motion (data flows)
- [AGENTS.md](../AGENTS.md) — the supervisor contract these components implement
- [docs/api.md](api.md) — HTTP surface produced by these modules
- [llms.txt](../llms.txt) — the 11 ADRs that justify the splits
