# Agent Operating Model

noaide watches AI coding agents. It does not run them. This document
describes the operating contract between the supervisor (the human), the
agent (Claude Code, Gemini CLI, Codex, …), and noaide.

Sections:

1. [Operating Model](#1-operating-model) — what noaide does and does not do
2. [Supervision Boundaries](#2-supervision-boundaries) — what the supervisor controls
3. [Evidence and Audit Loop](#3-evidence-and-audit-loop) — what noaide records and how to read it
4. [Agent Contract](#4-agent-contract) — how agents integrate

---

## 1. Operating Model

noaide is a browser-based IDE that observes and controls AI coding
agents running on the same host. The agents are separate processes.
noaide never executes or invokes them.

**What noaide does**

- **Reads JSONL conversation logs** from agent home directories
  (`~/.claude/`, `~/.gemini/`, `~/.codex/`) as the agent writes them.
  JSONL is the source of truth; everything in the UI is derived from it.
- **Watches the filesystem** with eBPF (`server/src/watcher/ebpf.rs`)
  and an inotify fallback. File events carry the PID that wrote them,
  so the UI can tell "Claude wrote this" from "you wrote this".
- **Hosts sessions** in two modes: *managed* (noaide spawns the agent in
  a PTY it owns, see `server/src/session/managed.rs`) and *observed*
  (the agent runs anywhere; noaide attaches via tmux send-keys for
  input, see `server/src/session/observed.rs`).
- **Proxies API calls** transparently. Agents point their base URL at
  noaide, noaide forwards to the real API, and the supervisor sees
  every request and response in a Network tab
  (`server/src/proxy/handler.rs`). Secrets are redacted on the way
  through.
- **Streams everything to the browser** over WebTransport (HTTP/3 QUIC)
  with Zstd-compressed, FlatBuffer-encoded frames on the hot path and
  MessagePack on the cold path.

**What noaide does not do**

- It does not implement or simulate any agent. The agent is a process
  you run separately.
- It does not mediate tool execution. When an agent runs a shell
  command, it runs on the host — noaide records it but does not sit in
  between.
- It does not mask or filter agent output. Everything the JSONL
  contains — including `system-reminder`, system prompts and provider
  transcript fields the official UI does not surface, intermediate
  transcript events, and compressed replies — is rendered.

## 2. Supervision Boundaries

The supervisor is the human running the system. noaide gives the
supervisor tools to see and control what the agent is doing.

**Control surfaces**

| Surface | Scope |
|---------|-------|
| **Session lifecycle** | Spawn, pause, resume, kill managed sessions. Attach and detach observed sessions. |
| **Input** | Send keystrokes, text, or images to the agent PTY or tmux pane. |
| **Tool approval** | For agents that emit tool-use requests, noaide can hold the request and wait for approval or denial before the agent proceeds. |
| **API proxy gate** | Requests can run in *auto* mode (forward everything) or *manual* mode (hold each request, supervisor chooses forward/drop/edit). See [noaide proxy docs](server/src/proxy/mod.rs). |
| **File lock** | When the agent is editing a file, concurrent edits from the supervisor are held in an OT buffer until the agent finishes. After that noaide runs a 3-way merge; on conflict a MergeView opens. |

**Trust boundaries**

- **API proxy whitelist**: only `api.anthropic.com`,
  `cloudcode-pa.googleapis.com`, and `chatgpt.com` are forwarded. Any
  other host is rejected.
- **Secret redaction**: `sk-ant-*`, `Bearer *`, and Anthropic session
  tokens are rewritten to `***` in both log output and the Network tab
  UI before anything reaches the browser.
- **PTY input**: commands sent from the UI are passed to the PTY
  verbatim; noaide does not invoke a shell on its own, and never uses
  `shell=true` in process spawn calls.
- **eBPF programs**: pre-compiled, load-time-verified by the kernel,
  never loaded from user input.

**What the supervisor cannot rely on noaide for**

- Sandbox enforcement. The agent runs with the same privileges as
  whichever user started it. noaide does not add a sandbox.
- Network isolation beyond the API proxy. Agents can still reach the
  network directly if they choose to bypass the configured base URL.
- Recovering from a killed kernel process. noaide reconnects to
  restarted sessions where it can, but a terminated agent must be
  restarted manually.

## 3. Evidence and Audit Loop

noaide is designed so every visible state has a traceable origin.

**Event envelope**

Every event crossing a component boundary is wrapped:

```rust
pub struct EventEnvelope {
    pub event_id: Uuid,
    pub source: EventSource,   // JSONL | PTY | Proxy | Watcher | User
    pub sequence: u64,
    pub logical_ts: u64,       // Lamport clock for global ordering
    pub wall_ts: i64,          // Unix timestamp
    pub session_id: SessionId,
    pub dedup_key: Option<String>,
}
```

The envelope carries enough information to reconstruct the order of
events across sources, deduplicate echoes (PTY sees its own output via
the file watcher), and attribute each event to a PID.

**Persistence layers**

| Layer | Role | Regeneratable? |
|-------|------|----------------|
| JSONL files on disk | Source of truth for agent conversations | No — owned by the agent |
| Limbo SQLite DB | Index and cache for fast queries / FTS5 search | Yes, from JSONL |
| ECS world state | In-memory hot path | Yes, from DB + JSONL |
| Network Inspector store | Request/response bodies captured by the proxy | No — kept only in-memory by default |

The JSONL-first design is deliberate: any time noaide's state looks
wrong, the recovery is to rebuild the DB and ECS from the JSONL files.

**Reading the audit trail**

- Every chat message in the UI exposes its source JSONL line number.
- Every file event carries the writing PID; the UI shows "you" vs. the
  agent session that wrote it.
- Every API request is stored with full headers and body in the
  Network tab, with redactions applied. Search is FTS-backed.
- Git integration (blame, diff, status) is rendered in line with the
  editor so edits can be correlated with commits.

## 4. Agent Contract

Agents are third-party processes. noaide integrates by standing
between the agent and its API backend, and by reading the files the
agent writes.

**Required integration points**

| Agent | JSONL path | Base URL override |
|-------|-----------|--------------------|
| Claude Code | `~/.claude/projects/{encoded}/{uuid}.jsonl` | `ANTHROPIC_BASE_URL=http://localhost:4434/s/{session}` |
| Gemini CLI | `~/.gemini/tmp/{project}/chats/session-*.json` | `CODE_ASSIST_ENDPOINT` and `GOOGLE_GEMINI_BASE_URL` both set |
| OpenAI Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `OPENAI_BASE_URL=http://localhost:4434/s/{session}/backend-api/codex` |

If an agent does not support a base URL override, noaide can still
observe it in read-only mode from the JSONL files — the Network tab
simply stays empty for that session.

**What noaide asks of the agent**

1. Write each conversation turn to disk as it happens (JSONL append is
   enough; noaide watches for offset changes).
2. Honour the base URL override when the supervisor has configured
   one.
3. Respect PTY input (managed) or tmux send-keys (observed) as the
   supervisor's input channel.

**What agents can rely on noaide for**

- Preservation. noaide never rewrites JSONL files; it only reads them.
- Transparency to the supervisor. Anything the agent writes becomes
  visible, which is the expected contract — noaide is not trying to
  hide output from the supervisor.
- Session resumability across browser reloads. The UI reconstructs
  state from JSONL on reconnect, so a dropped browser connection does
  not interrupt the agent.

---

## See Also

- [README.md](README.md) — overview, architecture diagram, tech stack
- [llms.txt](llms.txt) — the 11 ADRs that drive the architecture
- [CONTRIBUTING.md](CONTRIBUTING.md) — commit discipline, branch flow
- [SECURITY.md](SECURITY.md) — security controls in place and on the roadmap
