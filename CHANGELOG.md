# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-alpha.1] - 2026-04-24

First alpha release. The application builds, runs, and provides a
functional UI for watching AI coding agents (Claude Code, Gemini CLI,
Codex) in real time. Pre-alpha by any production definition — no
deployment story, no browser beyond Chromium, no benchmark suite —
but the end-to-end loop works against seeded fixtures and real
local sessions.

### Added — Backend
- Rust server on tokio with io_uring transport layer
- ECS state engine (`hecs`) with components for sessions, messages,
  files, tasks, agents
- Limbo async SQLite DB with FTS5 index behind the experimental flag
- eBPF file watcher with PID attribution (via aya) and inotify fallback
- Managed session manager (PTY + child process) and observed session
  manager (tmux send-keys)
- Multi-format JSONL parser with pluggable adapters for Claude Code,
  Gemini CLI, Codex
- Zenoh shared-memory event bus (~1 µs publish latency)
- WebTransport (HTTP/3 QUIC) server with adaptive 120/30/10 Hz quality
  tiers
- Per-session reverse proxy at `/s/{uuid}/...` with 5 modes
  (Auto/Manual/Custom/Pure/Lockdown), secret redaction, audit log,
  body rewrite, AES-256-GCM key rotation
- Git integration via libgit2: branches, status, diff, stage/unstage
  (hunk-level), commit, blame, log, PR listing
- TOGAF plan subsystem (plan.json + plan-edits.json round-trip)
- Whisper voice-to-text sidecar integration (FastAPI + WebSocket
  bridge, CUDA-accelerated)
- HTTP API with session, filesystem, git, plans, proxy, teams, and
  transcribe endpoints

### Added — Frontend (SolidJS + Vite)
- Three-panel layout (Sessions sidebar, tabbed center, Files right)
  with resizable dividers, mobile layout with bottom tab bar and
  swipe navigation
- Chat panel with breathing orb, virtual scroller, thinking blocks,
  ghost messages for compressed content, inline tool cards (11
  variants), markdown via WASM
- Editor panel with CodeMirror 6, MergeView for conflicts, file-edit
  lock banner and OT buffer
- Network Inspector with request/response bodies, timing, redaction,
  rule editor, category chips, quick-block
- Teams panel: topology graph, swimlane timeline, Gantt chart with
  per-agent time tracking, subagent tree
- Tasks panel with Kanban board (drag/drop)
- Plan panel with TOGAF ADM workflow
- Gallery, Cost dashboard, Profiler metrics, Command palette (Cmd+K),
  in-chat search (Cmd+F), export to Markdown/JSON/HTML, session
  pinning, keyboard shortcut sheet

### Added — Tooling and Docs
- `docker-compose.yml`, `justfile`, and `Makefile` for one-liner
  local development
- `scripts/setup-certs.sh` mkcert wrapper
- `AGENTS.md` with the supervisor/agent contract (Operating Model,
  Supervision Boundaries, Evidence Loop, Agent Contract)
- `docs/` with architecture, api, agent-operating-model, and
  supervision-boundaries reference pages
- Features table in README with source-file cross-references
- Three live screenshots in README Gallery section
- 11 ADRs recorded in `llms.txt`

### Added — CI and Quality
- CI pipeline: path-filtered Rust + frontend lint, test, build,
  security audit (cargo audit, pnpm audit, gitleaks, CodeQL); single
  `CI Gate` aggregate required check
- Nightly workflow: E2E tests, benchmarks, extended security scan,
  audit artefact upload
- Release workflow: WASM modules, frontend bundle, SHA256 checksums
- Issue Quality Gate, AC Evidence Gate, Issue Close Guard, Language
  Gate (English Only)
- CONTRIBUTING.md documents commit discipline (Conventional Commits
  + single-concern)
- SECURITY.md split into "In Place" and "Roadmap" with honest status

### Known limitations
- Production deployment story is open — see #143
- Performance numbers in the README are design goals, not measured;
  benchmark suite planned in #142
- Strict production CSP (#139), COOP/COEP production headers (#140),
  and `npm audit` in CI (#141) are on the roadmap
- `docs/` expansion (security-deep-dive, evidence-loop-details,
  component-reference, deployment-guide) tracked in #146
- eBPF requires `CAP_BPF` + `CAP_PERFMON` or the watcher transparently
  falls back to inotify
