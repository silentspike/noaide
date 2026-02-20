# noaide

[![CI](https://github.com/silentspike/noaide/actions/workflows/ci.yml/badge.svg)](https://github.com/silentspike/noaide/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Pre-Alpha](https://img.shields.io/badge/Status-Pre--Alpha-orange.svg)](#project-status)

Browser-based real-time IDE for AI coding agents. Built for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) first, with a pluggable adapter architecture for [Gemini CLI](https://github.com/google-gemini/gemini-cli) and [OpenAI Codex](https://github.com/openai/codex). Watch every JSONL message, manage sessions, inspect API calls, and collaborate with your AI — all in your browser at 120 Hz.

> **Note:** noaide is in active early development. Features listed below represent the target architecture. See [Project Status](#project-status) for current implementation progress. Multi-LLM adapter support (Gemini, Codex) is planned for Phase 2.

## Why noaide?

AI coding agents like Claude Code, Gemini CLI, and Codex write conversation logs (JSONL) that contain **everything** — system prompts, hidden messages, thinking blocks, tool calls, and results. The standard CLIs show only a fraction of this data.

noaide gives you full transparency:

- **Full JSONL Viewer** — Every message, including hidden and system-reminder content
- **Real-time File Watching** — eBPF-powered file change detection with PID attribution
- **Session Manager** — Discover, observe, and control AI coding sessions via PTY/tmux
- **API Network Inspector** — Transparent proxy for LLM API calls with timing data
- **Multi-LLM Ready** — Claude Code now, Gemini CLI and Codex via adapter architecture (Phase 2)
- **Team Visualizer** — See multi-agent team topologies and task boards
- **Conflict Resolution** — 3-way merge when you and Claude edit the same file
- **120 Hz Rendering** — SolidJS fine-grained reactivity with virtual scrolling

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (SolidJS)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │Chat Panel│ │File Tree │ │ Editor   │ │ Network   │  │
│  │(JSONL)   │ │(Watcher) │ │(CM6+OT) │ │ Inspector │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬─────┘  │
│       └─────────────┴────────────┴─────────────┘        │
│                         │ WebTransport (QUIC)            │
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│                  Rust Server (tokio)                     │
│  ┌──────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐  │
│  │eBPF File │ │ JSONL  │ │ Session  │ │  API Proxy  │  │
│  │ Watcher  │ │ Parser │ │ Manager  │ │ (Anthropic) │  │
│  └────┬─────┘ └───┬────┘ └────┬─────┘ └──────┬──────┘  │
│       └────────────┴───────────┴──────────────┘         │
│                         │ Zenoh (SHM)                    │
│                    ┌────┴────┐                           │
│                    │ hecs ECS│ (State Engine)             │
│                    └────┬────┘                           │
│                    ┌────┴────┐                           │
│                    │ Limbo DB│ (io_uring, FTS5)           │
│                    └─────────┘                           │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Rust + tokio + io_uring | Zero-cost abstractions, async I/O |
| Frontend | SolidJS + Vite | Fine-grained reactivity, no VDOM overhead |
| Transport | WebTransport (QUIC, 0-RTT) | Sub-50ms latency, multiplexed streams |
| State | hecs ECS | Cache-friendly struct-of-arrays iteration |
| Database | Limbo (async SQLite) | io_uring native, FTS5 full-text search |
| File Watch | eBPF via aya | Kernel-level PID attribution |
| Event Bus | Zenoh + SHM | ~1μs inter-component latency |
| Editor | CodeMirror 6 | 500KB, MergeView, collaborative |
| Codecs | FlatBuffers (hot) + MessagePack (cold) | Zero-copy + flexible serialization |
| WASM | jsonl-parser, markdown, compress | Off-main-thread heavy computation |
| Theme | Catppuccin Mocha | Consistent, accessible dark theme |

## Prerequisites

- **Rust** 1.87+ (with `nightly` for io_uring features)
- **Node.js** 22+ and npm
- **wasm-pack** 0.13+
- **mkcert** (for local TLS certificates)
- **flatc** (FlatBuffers compiler)
- Linux kernel 5.19+ (for eBPF and io_uring)

## Quick Start

```bash
# Clone
git clone https://github.com/silentspike/noaide.git
cd noaide

# Generate local TLS certificates
mkdir -p certs
mkcert -install
mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1

# Build WASM modules
for mod in jsonl-parser markdown compress; do
  wasm-pack build wasm/$mod --target web --out-dir ../../frontend/src/wasm/$mod
done

# Install frontend dependencies
cd frontend && npm install && cd ..

# Build server
cargo build --release

# Run
./target/release/noaide-server

# Open browser
# https://localhost:4433
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NOAIDE_PORT` | `4433` | WebTransport/QUIC port |
| `NOAIDE_HTTP_PORT` | `8080` | HTTP fallback port |
| `NOAIDE_DB_PATH` | `~/.local/share/noaide/ide.db` | Limbo database path |
| `NOAIDE_WATCH_PATHS` | `~/.claude/` | Directories to watch for JSONL |
| `NOAIDE_TLS_CERT` | `./certs/cert.pem` | TLS certificate path |
| `NOAIDE_TLS_KEY` | `./certs/key.pem` | TLS private key path |
| `NOAIDE_LOG_LEVEL` | `info` | Log level (trace/debug/info/warn/error) |

### Feature Flags

| Flag | Default | Description |
|------|---------|-------------|
| `ENABLE_EBPF` | `true` | eBPF file watching (false = inotify fallback) |
| `ENABLE_SHM` | `true` | Zenoh shared memory (false = TCP) |
| `ENABLE_WASM_PARSER` | `true` | WASM JSONL parser (false = JS fallback) |
| `ENABLE_API_PROXY` | `true` | Anthropic API proxy + Network tab |
| `ENABLE_PROFILER` | `false` | Performance profiler panel |

## Development

```bash
# Backend
cargo build                        # Dev build
cargo test                         # Run tests
cargo clippy -- -D warnings        # Lint
cargo build --release              # Release build

# Frontend
cd frontend
npm run dev                        # Vite dev server (HMR)
npm run build                      # Production build
npm run lint                       # ESLint

# WASM modules
wasm-pack build wasm/jsonl-parser --target web

# FlatBuffers schema
flatc --rust --ts -o generated/ schemas/messages.fbs
```

## Performance Targets

| Metric | Target |
|--------|--------|
| File event to browser | < 50ms (p99) |
| Rendering at 1000+ messages | 120 Hz |
| Server RSS | < 200 MB |
| Browser memory | < 500 MB |
| JSONL parse rate | > 10,000 lines/sec |
| Zenoh SHM latency | ~1μs |

## Project Status

noaide follows a [TOGAF ADM](https://www.opengroup.org/togaf) implementation plan with 20 work packages across 4 sprints.

| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Foundation (ECS, DB, Parser, Watcher, Bus) | Planned |
| S2 | Transport, Frontend Core, Session Manager | Planned |
| S3 | Advanced Features (Proxy, Git, Teams, Mobile) | Planned |
| S4 | Polish (Profiler, Accessibility, Docs, Release) | Planned |

Track progress via [GitHub Milestones](../../milestones) and [Issues](../../issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, commit conventions, and PR process.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[MIT](LICENSE)
