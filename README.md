<div align="center">

```
                        $$\       $$\
                        \__|      $$ |
 $$$$$$$\   $$$$$$\  $$\ $$$$$$\  $$$$$$\   $$$$$$\
$$  __$$\ $$  __$$\ $$ |$$  __$$\ $$  __$$\ $$  __$$\
$$ |  $$ |$$ /  $$ |$$ |$$ /  $$ |$$$$$$$$ |$$$$$$$$ |
$$ |  $$ |$$ |  $$ |$$ |$$ |  $$ |$$   ____|$$   ____|
$$ |  $$ |\$$$$$$  |$$ |\$$$$$$  |\$$$$$$$\ \$$$$$$$\
\__|  \__| \______/ \__| \______/  \_______| \_______|
```

**Browser-based real-time IDE for AI coding agents**

See everything your AI writes. Control every session. Catch every API call.

Requires your AI coding agent running in the background. Not included — you know who's watching. 👀
<br>The Truman Show × Westworld × The Sims — fully under your control. → [Project Sentinel](https://github.com/silentspike/project-sentinel)

<br>

[![CI](https://github.com/silentspike/noaide/actions/workflows/ci.yml/badge.svg)](https://github.com/silentspike/noaide/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Pre-Alpha](https://img.shields.io/badge/Status-Pre--Alpha-orange.svg)](#project-status)
[![Rust](https://img.shields.io/badge/Rust-1.87+-dea584.svg)](https://www.rust-lang.org/)
[![SolidJS](https://img.shields.io/badge/SolidJS-1.9+-4f88c6.svg)](https://www.solidjs.com/)
[![WebTransport](https://img.shields.io/badge/Transport-HTTP%2F3%20QUIC-8b5cf6.svg)](#tech-stack)

<br>

> **Pre-Alpha** — Architecture and CI/CD are in place. Implementation of core components has started.
> APIs and data formats will change. Not ready for production use.

---

</div>

## The Problem

AI coding agents like [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), and [Codex](https://github.com/openai/codex) generate rich conversation logs (JSONL) containing system prompts, hidden instructions, thinking blocks, tool calls, and results. Their terminal UIs show roughly **60% of this data** — the rest is suppressed.

noaide makes 100% visible.

## What It Does

<table>
<tr>
<td width="50%">

### Full JSONL Transparency

Every message rendered — including `system-reminder`,
thinking blocks, and content marked "don't display."
Compressed messages shown as ghost messages at 30%
opacity. Nothing hidden, nothing filtered.

### Real-time File Watching

eBPF kernel-level file monitoring with **PID attribution**:
know exactly which process (you or Claude) wrote each
change. Sub-millisecond event detection. inotify fallback
when eBPF is unavailable.

### Session Control

Spawn managed sessions (full PTY control) or attach to
existing ones (tmux send-keys). Bidirectional — not just
a viewer. Breathing orb shows AI state in real-time.

### Conflict Resolution

When you and Claude edit the same file simultaneously:
yellow banner, OT buffer holds your changes, 3-way merge
after Claude finishes, auto Merge View on conflict.

</td>
<td width="50%">

### API Network Inspector

Transparent reverse proxy for Anthropic API calls.
Full request/response bodies, timing waterfall, token
usage — all in a browser Network tab. API keys
automatically redacted.

### Multi-Agent Teams

Force-directed topology graph showing agent hierarchies.
Animated message bubbles on edges. Swimlane timeline
for parallel agent activity. Gantt charts with per-agent
time tracking.

### 120 Hz Rendering

SolidJS fine-grained reactivity (no Virtual DOM). Virtual
scroller renders ~25 DOM nodes regardless of message count.
WASM workers for JSONL parsing and Markdown rendering.
Spring-physics animations.

### Mobile Access

Responsive layout with bottom tab bar and swipe navigation.
WebTransport QUIC with connection migration (WiFi to
cellular seamless handoff). Voice input via Web Speech API.

</td>
</tr>
</table>

## UI Layout

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

<sup>Three resizable panels. Left: session list with breathing orbs. Center: tabbed views (chat, editor,
network, teams). Right: file tree, token budget, model info. Bottom bar for quick navigation and
command palette.</sup>

## Architecture

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
                              HTTP/3 QUIC │ TLS 1.3
                              0-RTT       │ Multiplexed
                              Zstd ~70%   │ Adaptive Quality
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

## Tech Stack

<table>
<tr><th align="left">Layer</th><th align="left">Choice</th><th align="left">Rationale</th></tr>
<tr><td><b>Backend</b></td><td>Rust + tokio + io_uring</td><td>Zero-cost abstractions, memory safety, async I/O</td></tr>
<tr><td><b>Frontend</b></td><td>SolidJS + Vite 6</td><td>Fine-grained reactivity without Virtual DOM overhead</td></tr>
<tr><td><b>Transport</b></td><td>WebTransport (HTTP/3, QUIC)</td><td>0-RTT reconnect, multiplexed streams, connection migration</td></tr>
<tr><td><b>State</b></td><td>hecs ECS (struct-of-arrays)</td><td>Cache-friendly iteration over 100+ concurrent entities</td></tr>
<tr><td><b>Database</b></td><td>Limbo (async SQLite, io_uring)</td><td>FTS5 full-text search, JSONL remains source of truth</td></tr>
<tr><td><b>File Watch</b></td><td>eBPF via aya</td><td>Kernel-level PID attribution for conflict detection</td></tr>
<tr><td><b>Event Bus</b></td><td>Zenoh + shared memory</td><td>~1us inter-component latency, zero-copy IPC</td></tr>
<tr><td><b>Editor</b></td><td>CodeMirror 6</td><td>500 KB (vs Monaco 5 MB), built-in MergeView</td></tr>
<tr><td><b>Wire Format</b></td><td>FlatBuffers + MessagePack + Zstd</td><td>Zero-copy hot path, flexible cold path, ~70% compression</td></tr>
<tr><td><b>WASM</b></td><td>jsonl-parser, markdown, compress</td><td>Off-main-thread heavy computation via Web Workers</td></tr>
<tr><td><b>Theme</b></td><td>Catppuccin Mocha</td><td>14 harmonious dark colors, community standard</td></tr>
</table>

Architectural decisions are documented as [11 ADRs in llms.txt](llms.txt). Each records the context, decision, alternatives considered, and trade-offs accepted.

## Performance Targets

```
File event to browser       ████████████████████████████░░  < 50ms p99
Rendering (1000+ msgs)      ██████████████████████████████  120 Hz
Server RSS (5 sessions)     █████████████░░░░░░░░░░░░░░░░░  < 200 MB
Browser memory              ████████████████░░░░░░░░░░░░░░  < 500 MB
JSONL parse rate            ██████████████████████████████  > 10k lines/s
Zenoh SHM latency           ██████████████████████████████  ~1 us
API proxy overhead          ██████████████████████████████  < 5 ms
Zstd bandwidth reduction    █████████████████████░░░░░░░░░  ~70%
```

## Prerequisites

| Dependency | Version | Notes |
|------------|---------|-------|
| Rust | 1.87+ | nightly required for io_uring features |
| Node.js | 22+ | with npm |
| wasm-pack | 0.13+ | for WASM module compilation |
| mkcert | latest | local TLS certificates for WebTransport |
| flatc | latest | FlatBuffers schema compiler |
| Linux kernel | 5.19+ | eBPF and io_uring support |

<details>
<summary><b>Optional: eBPF capabilities</b></summary>

For eBPF file watching (recommended), the kernel needs `CONFIG_BPF=y` and `CONFIG_BPF_SYSCALL=y`, and the process needs `CAP_BPF` + `CAP_PERFMON` (or `CAP_SYS_ADMIN` on kernels < 5.8). Without these, noaide falls back to inotify automatically.

Verify: `grep CONFIG_BPF /boot/config-$(uname -r)`

</details>

## Quick Start

```bash
# Clone
git clone https://github.com/silentspike/noaide.git && cd noaide

# Generate local TLS certificates (required for WebTransport)
mkdir -p certs
mkcert -install
mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1

# Build WASM modules
for mod in jsonl-parser markdown compress; do
  wasm-pack build wasm/$mod --target web --out-dir ../../frontend/src/wasm/$mod
done

# Install frontend dependencies and build
cd frontend && npm install && npm run build && cd ..

# Build and run server
cargo build --release
./target/release/noaide-server

# Open in browser
# https://localhost:4433
```

## Configuration

<details>
<summary><b>Environment variables</b></summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `NOAIDE_PORT` | `4433` | WebTransport/QUIC port |
| `NOAIDE_HTTP_PORT` | `8080` | HTTP port (health endpoint, API proxy) |
| `NOAIDE_DB_PATH` | `~/.local/share/noaide/ide.db` | Limbo database path |
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

</details>

## Development

```bash
# ── Backend ──────────────────────────────────
cargo build                              # dev build
cargo test                               # unit + integration tests
cargo clippy -- -D warnings              # lint
cargo bench                              # performance benchmarks

# ── Frontend ─────────────────────────────────
cd frontend
npm run dev                              # Vite dev server with HMR
npm run build                            # production build
npm run lint                             # ESLint

# ── WASM ─────────────────────────────────────
wasm-pack build wasm/jsonl-parser --target web
wasm-pack build wasm/markdown --target web
wasm-pack build wasm/compress --target web

# ── FlatBuffers ──────────────────────────────
flatc --rust --ts -o generated/ schemas/messages.fbs
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch conventions, commit style, and PR process.
See [TESTING.md](TESTING.md) for the full test gate matrix and benchmark commands.

## Project Status

noaide is developed in 4 sprints with 20 work packages. Track progress via [Milestones](../../milestones) and [Issues](../../issues).

```
Sprint 1 ── Foundation                             ░░░░░░░░░░░░░░  Planned
             ECS state, Limbo DB, JSONL parser,
             eBPF watcher, session manager

Sprint 2 ── Streaming Pipeline                     ░░░░░░░░░░░░░░  Planned
             Zenoh event bus, WebTransport,
             SolidJS shell, WASM modules

Sprint 3 ── Frontend                               ░░░░░░░░░░░░░░  Planned
             Chat panel, editor, sessions,
             API proxy, tools, teams, tasks

Sprint 4 ── Integration                            ░░░░░░░░░░░░░░  Planned
             Mobile layout, performance
             tuning, command palette, polish
```

<details>
<summary><b>Completed so far</b></summary>

- Project scaffolding and repository structure
- CI/CD pipeline (9 jobs, path-filtered, concurrency-managed)
- Nightly pipeline (E2E, benchmarks, extended security)
- Release pipeline (WASM, frontend bundle, SHA256 checksums)
- Security scanning (Gitleaks, Semgrep, CodeQL, cargo-audit)
- GitHub community files and issue quality gate
- 11 Architecture Decision Records
- 20 work package issues with dependency graph

</details>

## Multi-LLM Support

noaide is built for Claude Code first, with an adapter architecture planned for Phase 2:

| Agent | Status | Notes |
|-------|--------|-------|
| **Claude Code** | Primary target | Full JSONL support, PTY + tmux session control |
| **Gemini CLI** | Phase 2 | Adapter for Gemini conversation format |
| **OpenAI Codex** | Phase 2 | Adapter for Codex session format |

The JSONL parser and session manager are designed with pluggable format adapters. Core UI components (chat panel, editor, network tab) are agent-agnostic.

## Security

API keys (`sk-ant-*`, `Bearer *`) are automatically redacted in all logs and UI via regex. The API proxy only forwards to `api.anthropic.com` (whitelist). All transport uses TLS 1.3 via QUIC. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[MIT](LICENSE)

---

<div align="center">
<sub>Built with Rust, SolidJS, and too many late nights reading JSONL files.</sub>
</div>
