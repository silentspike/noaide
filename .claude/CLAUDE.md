# CLAUDE CODE - claude-ide

**Sprache:** Deutsch
**Typ:** Full-Stack Web Application (Rust Backend + SolidJS Frontend + WASM)
**SSOT:** `IMPL-PLAN.md` (TOGAF ADM Level L, v2.2)

---

## SECTION 1: CRITICAL RULES

### NIEMALS
- Editiere Files OHNE sie vorher zu lesen (Read before Edit!)
- Committe `.env`, `*.key`, `*.pem`, `*.db`, credentials
- Starte eigene HTTP-Server (`python -m http.server` etc.) — nginx auf `:8000` nutzen!
- Verwende `cargo build` lokal — IMMER `cargo remote -- build` (Build-Server CT 155)
- Verwende `claude -p --resume` fuer Sessions — PTY stdin + tmux send-keys (ADR-9)
- Filtere oder verstecke JSONL-Inhalte — ALLES wird angezeigt (Full Transparency Prinzip)
- Speichere API Keys (`sk-ant-*`, `Bearer *`) in Logs oder UI — automatische Regex-Redaction Pflicht
- Verwende WebSocket Fallback — WebTransport-only (ADR-8)
- Verwende React/VDOM — SolidJS fine-grained Reactivity (ADR-2)
- Verwende HashMap fuer State — ECS (hecs) Struct-of-Arrays (ADR-6)
- Verwende rusqlite — Limbo mit io_uring (ADR-4)
- Verwende inotify direkt — eBPF/aya mit inotify als Fallback (ADR-5)
- Verwende NATS — Zenoh + SHM (ADR-3)
- Verwende Monaco Editor — CodeMirror 6 (ADR-11)
- Lasse Mocks/Stubs/Placeholder im Production-Pfad — scope:full (Production-First)
- Aendere den Plan ohne HTML-Dashboard zu aktualisieren (Living Documentation)
- Aendere Features ohne README.md zu aktualisieren (User-facing Living Doc!)
- Schliesse ein WP ab ohne Lessons Learned in dieser CLAUDE.md zu dokumentieren
- Schreibe GitHub-Inhalte auf Deutsch — ALLES auf GitHub MUSS Englisch sein! (README, Issues, PRs, Commits, Comments, Labels, Workflows, Templates)

### IMMER
- **Aktuellste Versionen** aller Dependencies installieren! `cargo update`, `npm update`, crate-Versionen auf latest pruefen. Keine veralteten Packages!
- `cargo remote -- build|test|clippy|bench` fuer ALLE Rust-Builds (Build-Server)
- Read before Edit — JEDES File vor Bearbeitung lesen
- JSONL ist SSOT — Limbo DB ist Index/Cache, KANN jederzeit regeneriert werden
- API Keys redacten: `sk-ant-*` und `Bearer *` per Regex in Logs UND UI
- COOP/COEP Header setzen (SharedArrayBuffer fuer WASM Workers)
- Fonts self-hosted (Monaspace Neon + Inter WOFF2, kein CDN wegen COEP)
- Feature Flags fuer experimentelle Komponenten nutzen
- EventEnvelope mit Lamport Clock + Dedup fuer ALLE System-Events
- Bounded Channels mit Drop-Policy fuer Backpressure
- `IMPL-PLAN.md` UND `.audit/plan-claude-ide.html` UND `README.md` synchron halten
- VERIFY-Protokoll nach jedem WP ausfuehren (Tests + Observability + Lessons)
- Lessons sofort in diese CLAUDE.md schreiben (nicht erst am Ende)
- README.md aktualisieren wenn sich Features, Config, Setup oder Status aendern (User-facing!)
- Lessons Learned Sektion in dieser CLAUDE.md von Anfang bis Ende der Entwicklung pflegen (ZWINGEND!)
- ALLES auf GitHub in Englisch schreiben (README, Issues, PRs, Commits, Comments, Labels, Workflows)
- CI Language Gate prueft automatisch auf deutsche Inhalte in GitHub-relevanten Files

---

## SECTION 2: ARCHITECTURE DECISIONS (ADRs — NICHT aendern ohne Change Request!)

| ADR | Entscheidung | Statt |
|-----|-------------|-------|
| ADR-1 | **Rust** Backend (tokio + io_uring) | Go, Node |
| ADR-2 | **SolidJS** Frontend (fine-grained) | React, Svelte |
| ADR-3 | **Zenoh + SHM** Event Bus (~1us) | NATS, tokio broadcast |
| ADR-4 | **Limbo** DB (io_uring, FTS5, async) | rusqlite, redb |
| ADR-5 | **eBPF** File Watcher (PID-Tracing) | inotify (Fallback) |
| ADR-6 | **hecs ECS** State (SoA, cache-friendly) | HashMap |
| ADR-7 | **FlatBuffers** hot + **MessagePack** cold | Single Codec |
| ADR-8 | **WebTransport-only** (QUIC, 0-RTT) | WebSocket Fallback |
| ADR-9 | **PTY stdin** + tmux send-keys | claude -p --resume |
| ADR-10 | **Catppuccin Mocha** Theme | Nord, Dracula |
| ADR-11 | **CodeMirror 6** (500KB, MergeView) | Monaco (5MB) |

---

## SECTION 3: WORKFLOWS

### Build & Test
```bash
# Rust Build (IMMER remote!)
cargo remote -- build
cargo remote -- build --release
cargo remote -- test
cargo remote -- test -p server -- ecs        # Einzelnes Modul
cargo remote -- test --test integration      # Integration Tests
cargo remote -- clippy                       # Lint
cargo remote -- bench                        # Benchmarks

# WASM Build
wasm-pack build wasm/jsonl-parser --target web
wasm-pack build wasm/markdown --target web
wasm-pack build wasm/compress --target web

# Frontend
cd /work/claude-ide/frontend && npm install
cd /work/claude-ide/frontend && npm run dev   # Dev Server (Vite 6)
cd /work/claude-ide/frontend && npm run build  # Production Build
cd /work/claude-ide/frontend && npm run lint   # ESLint

# E2E Tests (Playwright via Docker)
docker run --rm --network host -v /tmp:/tmp deepdive-playwright node /tmp/e2e-test.js

# FlatBuffers Schema compilieren
flatc --rust --ts -o generated/ schemas/messages.fbs
```

### Work Package Workflow (TOGAF ADM)
1. WP aus `IMPL-PLAN.md` lesen (E.4 Sektion)
2. Abhaengigkeiten pruefen (E.5 Dependency Graph)
3. Kanban-Status auf "In Progress" setzen
4. Code implementieren (scope:full, keine Stubs!)
5. Tests schreiben + ausfuehren
6. **VERIFY** ausfuehren:
   - Tests: Command + Output dokumentieren
   - Observability-Check: Logging + Metriken
   - Lessons-Check: Unerwartetes → diese CLAUDE.md
7. Kanban-Status auf "Done"
8. HTML-Dashboard aktualisieren (Living Documentation!)

### Conflict Resolution Workflow
1. eBPF erkennt PID-Attribution (wer schreibt)
2. Claude = Authority bei gleichzeitigem Edit
3. Gelber Banner: "Claude bearbeitet diese Datei"
4. User-Edits in OT-Buffer halten
5. Nach Claude-Edit: 3-Wege-Merge
6. Bei Konflikt: auto Merge View oeffnen

---

## SECTION 4: PROJECT CONTEXT

### Quick Start
- **Build:** `cargo remote -- build` (Rust) + `npm run build` (Frontend)
- **Test:** `cargo remote -- test` + `npm test`
- **Lint:** `cargo remote -- clippy` + `npm run lint`
- **Run:** `cargo remote -- run` (Server) + `npm run dev` (Frontend)
- **Health:** `curl -k https://localhost:4433/health`

### Projekt-Beschreibung
Browser-basierte Real-time IDE fuer Claude Code. Rust-Backend watched JSONL-Files via eBPF, managed Sessions ueber PTY/tmux, proxied API-Calls, streamt alles ueber HTTP/3 WebTransport an SolidJS-Frontend. Ziel: ALLES aus dem JSONL anzeigen (inkl. hidden, system-reminder, thinking), 120Hz Rendering, <50ms File-Event-to-Browser Latenz.

### Projekt-Struktur
```
/work/claude-ide/
  IMPL-PLAN.md                    # TOGAF ADM Level L Plan (SSOT!)
  .audit/plan-claude-ide.html     # HTML Dashboard (lebendes Dokument!)
  Cargo.toml                      # Workspace Root
  server/
    Cargo.toml
    src/
      main.rs                     # Entry Point, Component Wiring
      ecs/                        # hecs ECS World (State Engine)
        mod.rs, components.rs, systems.rs, world.rs
      db/                         # Limbo DB (Database)
        mod.rs, schema.rs, queries.rs
      watcher/                    # eBPF/fanotify (File Watcher)
        mod.rs, ebpf.rs, events.rs, fallback.rs
      parser/                     # JSONL Streaming Parser (JSONL Engine)
        mod.rs, jsonl.rs, types.rs
      discovery/                  # ~/.claude/ Session Scanner
        mod.rs, scanner.rs
      session/                    # PTY + tmux (Session Manager)
        mod.rs, managed.rs, observed.rs, types.rs
      bus/                        # Zenoh + SHM (Event Bus)
        mod.rs, zenoh_bus.rs, topics.rs
      transport/                  # WebTransport + Codecs (Transport)
        mod.rs, webtransport.rs, codec.rs, adaptive.rs
      proxy/                      # API Proxy (API Proxy)
        mod.rs, handler.rs, mitm.rs
      git/                        # libgit2 (Git Integration)
        mod.rs, blame.rs, status.rs
      teams/                      # Team Config (Team Visualizer)
        mod.rs, discovery.rs, topology.rs
  wasm/
    jsonl-parser/src/lib.rs       # WASM JSONL Parser
    markdown/src/lib.rs           # WASM Markdown (pulldown-cmark)
    compress/src/lib.rs           # WASM Zstd Decoder
  frontend/
    package.json, vite.config.ts, index.html
    src/
      App.tsx
      styles/tokens.css, global.css    # Catppuccin Mocha Tokens
      layouts/ThreePanel.tsx, MobileLayout.tsx
      transport/client.ts, codec.ts    # WebTransport Client
      stores/session.ts
      workers/                         # WASM Web Workers
        jsonl.worker.ts, markdown.worker.ts, compress.worker.ts
      components/
        chat/          # 12 Files: ChatPanel, MessageCard, ToolCard, etc.
        editor/        # EditorPanel, DiffView, BlameGutter, ConflictBanner
        files/         # FileTree, FileNode
        sessions/      # SessionList, SessionCard, SessionStatus
        network/       # NetworkPanel, RequestRow, RequestDetail
        tools/         # 11 Tool-Cards (Edit, Bash, Read, Grep, etc.)
        teams/         # TeamsPanel, TopologyGraph, Swimlane, etc.
        tasks/         # KanbanBoard, KanbanColumn, KanbanCard
        gantt/         # GanttPanel, GanttChart, GanttBar, TimeTracker
        gallery/       # GalleryPanel, Lightbox
        mobile/        # BottomTabBar, SwipeView, VoiceInput
        profiler/      # ProfilerPanel
        settings/      # SettingsPanel
        shared/        # CommandPalette, ContextMenu, SkeletonLoader
      hooks/           # useMediaQuery, useHaptic
      shortcuts/       # keymap.ts
      lib/             # ot-buffer.ts (Conflict Resolution)
  schemas/
    messages.fbs                  # FlatBuffers Schema
  certs/                          # mkcert TLS Certs (gitignored!)
```

### Environment Variables
| Variable | Default | Secret? |
|----------|---------|---------|
| `CLAUDE_IDE_PORT` | `4433` | Nein |
| `CLAUDE_IDE_HTTP_PORT` | `8080` | Nein |
| `CLAUDE_IDE_DB_PATH` | `/data/claude-ide/ide.db` | Nein |
| `CLAUDE_IDE_WATCH_PATHS` | `~/.claude/` | Nein |
| `CLAUDE_IDE_JWT_SECRET` | (generiert) | **Ja** |
| `CLAUDE_IDE_TLS_CERT` | `./certs/cert.pem` | Nein |
| `CLAUDE_IDE_TLS_KEY` | `./certs/key.pem` | **Ja** |
| `ANTHROPIC_BASE_URL` | `http://localhost:4434` | Nein |
| `CLAUDE_IDE_LOG_LEVEL` | `info` | Nein |

### Feature Flags
| Flag | Default | Beschreibung |
|------|---------|-------------|
| `ENABLE_EBPF` | `true` | eBPF File Watching (false → inotify) |
| `ENABLE_SHM` | `true` | Zenoh SHM (false → TCP) |
| `ENABLE_WASM_PARSER` | `true` | WASM Parser (false → JS) |
| `ENABLE_API_PROXY` | `true` | API Proxy + Network Tab |
| `ENABLE_PROFILER` | `false` | Performance Profiler Panel |
| `ENABLE_AUDIO` | `false` | UI Sounds |

### Performance Targets
| Metrik | Ziel |
|--------|------|
| File-Event → Browser | < 50ms (p99) |
| FPS bei 1000+ Messages | 120Hz |
| Server RSS | < 200MB |
| Browser Memory | < 500MB |
| JSONL Parse Rate | > 10000 Lines/sec |
| Zenoh SHM Latenz | ~1us |
| API Proxy Overhead | < 5ms |
| Zstd Bandwidth Reduction | ~70% |

### Wire Protocol
- **Hot Path** (~200 events/sec): FlatBuffers zero-copy + Zstd
- **Cold Path** (~2 events/sec): MessagePack flexible + Zstd
- **Adaptive Quality:** <50ms RTT = 120Hz | 50-150ms = 30Hz | >150ms = 10Hz
- **Backpressure:** Bounded channels, `file.change` oldest-first drop bei >500, `message.new` NEVER drop

### EventEnvelope (ALLE Events)
```rust
pub struct EventEnvelope {
    pub event_id: Uuid,
    pub source: EventSource,      // JSONL | PTY | Proxy | Watcher | User
    pub sequence: u64,            // Monoton steigend pro Source
    pub logical_ts: u64,          // Lamport Clock (globale Ordnung)
    pub wall_ts: i64,             // Unix Timestamp
    pub session_id: SessionId,
    pub dedup_key: Option<String>, // Echo-Dedup
}
```

### Breathing Orb States
| State | PTY Signal | JSONL Ground-Truth | Farbe | Animation |
|-------|-----------|-------------------|-------|-----------|
| IDLE | Keine Ausgabe >2s | `stop_reason: "end_turn"` | Lavender | Slow pulse 2s |
| THINKING | Braille-Spinner | `type: "thinking"` | Mauve | Fast pulse 0.5s |
| STREAMING | Block-Cursor + Text | `stop_reason: null` | Blue | Breathing 1s |
| TOOL_USE | Tool-Pattern | `type: "tool_use"` | Peach | Rotate 1.5s |
| ERROR | stderr, Exit != 0 | `is_error: true` | Red | Rapid pulse 0.3s |

### Error Handling
| Kategorie | Beispiele | Strategie |
|-----------|-----------|-----------|
| Fatal | DB corrupt, Port belegt | Graceful Shutdown + Browser Overlay |
| Transient | JSONL locked, WS disconnect | Retry exp. backoff (max 5, 100ms→3.2s) |
| Recoverable | Parse error, eBPF fail | Skip + Warning, Fallback wenn vorhanden |
| Expected | Session ended, File deleted | Normaler Control Flow |

### Security
- TLS: QUIC/TLS 1.3 via quinn, mkcert lokale CA
- Auth: JWT Token + API Key
- Redaction: `sk-ant-*`, `Bearer *` per Regex
- CSP: Strict, SolidJS escaped by default
- PTY Input: Sanitized, kein shell=true
- API Proxy: Whitelist nur `api.anthropic.com`
- CORS: Strict same-origin
- COOP/COEP: Cross-Origin-Isolation fuer SharedArrayBuffer
- eBPF: Nur vorverifizierte Programme, kein dynamisches Laden

---

## SECTION 5: REFERENCES

### SSOT (Single Source of Truth)
| Was | Autoritative Quelle |
|-----|---------------------|
| Architektur + Plan | `IMPL-PLAN.md` |
| HTML Dashboard | `.audit/plan-claude-ide.html` (lebendes Dokument!) |
| JSONL Format | Claude Code JSONL Files (`~/.claude/`) |
| Conversations | JSONL Files (DB ist nur Cache) |
| ADRs (11 Entscheidungen) | `IMPL-PLAN.md` Sektion E.3 |
| Acceptance Criteria (20) | `IMPL-PLAN.md` Sektion B.3 |
| Work Packages (20) | `IMPL-PLAN.md` Sektion E.4 |
| Dependency Graph | `IMPL-PLAN.md` Sektion E.5 |
| Risiken (13) | `IMPL-PLAN.md` Sektion E.2 |

### Wichtige Pfade
| Was | Pfad |
|-----|------|
| Implementierungsplan | `/work/claude-ide/IMPL-PLAN.md` |
| HTML Dashboard | `/work/claude-ide/.audit/plan-claude-ide.html` |
| Projekt-Root | `/work/claude-ide/` |
| Browser-Zugriff | `http://localhost:8000/claude-ide/` |
| Limbo DB | `/data/claude-ide/ide.db` |
| TLS Certs | `/work/claude-ide/certs/` |
| Build-Server | `root@10.0.0.155` (CT 155, cargo-remote) |

### Modulare Rules
Detaillierte Guidelines in `.claude/rules/`:
- `rust-patterns.md` — Rust Code Conventions, ECS Patterns, Error Handling
- `solidjs-patterns.md` — SolidJS Conventions, Reactivity Rules, Component Structure
- `wasm-patterns.md` — WASM Worker Patterns, SharedArrayBuffer, Performance

---

## Projekt-Learnings (ZWINGEND aktuell halten!)

**CRITICAL:** Diese Sektion ist ein lebendes Dokument und MUSS von Anfang bis Ende der
Entwicklung kontinuierlich gepflegt werden. Nach JEDEM Work Package, JEDEM VERIFY-Protokoll,
und bei JEDER unerwarteten Erkenntnis wird hier SOFORT geschrieben — nicht erst am Ende!

Jeder Eintrag enthaelt: Was passiert ist, Wann (Datum + WP), Warum es wichtig ist.

### NIEMALS (gelernt)
_(noch keine — wird waehrend Implementation gefuellt)_

### IMMER (gelernt)
_(noch keine — wird waehrend Implementation gefuellt)_

### Kontext
_(noch keine — wird waehrend Implementation gefuellt)_
