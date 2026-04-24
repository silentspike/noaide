# Supervision Boundaries

> This document expands [AGENTS.md §2](../AGENTS.md#2-supervision-boundaries).
> Read AGENTS.md first — it is the contract. This document explains
> each control surface in more detail and shows what noaide does and
> does not enforce.

## Who controls what

The supervisor is the human using the UI. The agent is a separate
process. noaide stands between them and mediates specific surfaces:

| Surface | Supervisor control | Agent control | Enforcement |
|---------|--------------------|----------------|-------------|
| Session lifecycle | Start, stop, kill, restart | Exit on its own | Managed mode: PTY + child-process API |
| Keyboard / text input | Send input events | Consume input | PTY write (managed), tmux send-keys (observed) |
| Tool approval | Hold / approve / deny | Request a tool | UI gate + proxy hold (where wired) |
| API proxy | Auto vs. manual mode, drop, replay | Send HTTP | Reverse proxy middleware |
| File-edit locks | Hold concurrent edits in OT buffer | Edit via tool-call | 3-way merge after agent finishes |

## Session lifecycle

### Managed

A managed session is a child process under noaide's PTY. The server
owns its stdin/stdout/stderr and its exit.

Lifecycle API:

- `POST /api/sessions/managed` — spawn
- `POST /api/sessions/{id}/close` — send SIGTERM, then SIGKILL after 5 s

noaide persists the session metadata so that the session list
survives restarts, but the process itself does not — if the server
dies, a managed session dies with it.

### Observed

An observed session is any agent running in a tmux pane that matches
noaide's discovery filter. noaide attaches read-only to the JSONL
and, optionally, writes input via `tmux send-keys`.

There is no "kill" for observed sessions. The supervisor closes the
pane themselves.

## Input channels

Two routes:

- `/api/sessions/{id}/input` — raw bytes. Useful for sending
  signals, arrow keys, control characters. The server writes exactly
  what it receives.
- `/api/sessions/{id}/send` — a "user message" abstraction. This
  handles the per-agent submit handshake. Gemini's Ink TUI, for
  instance, collapses `text\r` sent in one write into a newline
  character; the send route splits text and carriage return with a
  30 ms delay so the TUI treats the `\r` as submit.

Both routes go to the same `SessionManager.send_input()` call — the
difference is the pre-processing layer on top.

## Tool approval and the proxy gate

noaide does not sit between the agent and its tool execution (shell
commands, file writes, etc.). The agent runs those directly on the
host.

noaide does sit between the agent and its LLM provider. The proxy
operates in one of two modes:

- **auto** — requests stream through as the agent sends them. Every
  request is recorded for later inspection but nothing is blocked.
- **manual** — noaide holds each request, surfaces it in the UI, and
  waits for the supervisor to click Forward or Drop. Responses flow
  through the same gate.

Manual mode is the closest noaide has to tool approval: because the
tool-use envelope is returned by the LLM, the supervisor sees the
planned tool call before the agent does and can drop the response to
prevent it.

## API proxy guarantees

The proxy is a whitelist. Only these upstreams forward:

- `api.anthropic.com`
- `cloudcode-pa.googleapis.com`
- `chatgpt.com`

Anything else gets `502 Bad Gateway`.

Secret redaction runs before both the audit log and the UI
representation. Patterns (regex):

- `sk-ant-[A-Za-z0-9_-]+`
- `Bearer [A-Za-z0-9_.~+/=-]+`
- Claude session tokens and Anthropic billing IDs

The audit log rotates and exports as NDJSON (`/api/proxy/audit/export`)
so supervisors can take forensic copies.

## File-edit locks

When the agent starts editing a file (the UI detects this from the
`tool_use` envelope for `Edit`, `Write`, or `MultiEdit` on Claude, or
the equivalent for Gemini/Codex), noaide:

1. Opens a yellow banner in the editor for that file.
2. Holds supervisor edits in an Operational Transform buffer.
3. Waits for the agent's matching `tool_result`.
4. Runs a 3-way merge: agent's new content × your buffered edits ×
   the common ancestor.
5. On a clean merge, applies both automatically and clears the banner.
6. On a conflict, opens CodeMirror's MergeView so the supervisor can
   resolve manually.

The OT buffer is in-memory only. If the browser refreshes mid-edit,
the unmerged supervisor edits are lost.

## What noaide does not enforce

These are supervisor responsibilities, not noaide features:

- **Sandboxing.** The agent runs with the supervisor's privileges.
  noaide does not namespace, drop capabilities, or seccomp the child.
- **Filesystem limits.** The agent can read and write anywhere the
  supervisor can.
- **Network controls beyond the proxy.** If the agent wants to make
  a request outside the whitelist, noaide refuses to forward it — but
  the agent can bypass noaide by calling the real URL directly from
  its own HTTP client.
- **Secrets hygiene.** noaide redacts known secret patterns from the
  UI, but the underlying agent still sees them. A secret that the
  agent has in memory is not "revoked" by the redaction.

These boundaries are intentional. noaide is a transparency and
supervision tool, not a sandbox.

## Related docs

- [AGENTS.md](../AGENTS.md) — the supervisor contract
- [agent-operating-model.md](agent-operating-model.md) — how noaide watches the agent
- [architecture.md](architecture.md) — components behind these surfaces
- [api.md](api.md) — the HTTP routes this document references
- [../SECURITY.md](../SECURITY.md) — security controls in place and on the roadmap
