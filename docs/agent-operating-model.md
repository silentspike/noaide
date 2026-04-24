# Agent Operating Model

> This document expands [AGENTS.md §1](../AGENTS.md#1-operating-model).
> Read AGENTS.md first — it is the contract. This document is the
> implementation-level explanation.

## Observer, not runner

noaide never invokes an agent. The agent is a separate process that
the supervisor (or the supervisor's tooling) started before or after
noaide. noaide's role is to watch.

This distinction matters because it shapes the failure model:

- If noaide crashes, the agent keeps running. On restart, noaide
  reconstructs state from the JSONL files.
- If the agent crashes, noaide sees its PTY close (managed) or its
  tmux pane go idle (observed). Session state in the UI goes to
  `Ended`. The JSONL on disk is the durable record.
- noaide cannot repair an agent that has locked up. The supervisor
  can kill it via `/api/sessions/{id}/close` (managed) or manually
  (observed).

## What is observed

For each agent, noaide derives the full UI state from three inputs:

1. **JSONL on disk** — one line per conversation turn. Claude Code
   writes to
   `~/.claude/projects/{encoded-project-path}/{session-uuid}.jsonl`.
   Gemini CLI writes JSON files under
   `~/.gemini/tmp/{project-hash}/chats/session-*.json`. Codex writes
   to `~/.codex/sessions/YYYY/MM/DD/rollout-*-{uuid}.jsonl`.

2. **PTY output** (managed sessions only) — the raw terminal buffer.
   noaide uses this to animate the Breathing Orb (IDLE / THINKING /
   STREAMING / TOOL_USE / ERROR) because JSONL writes lag behind the
   visible cursor.

3. **Filesystem events** — eBPF ringbuf from the kernel, attributed by
   PID. When the agent's PID writes to a tracked file, the UI marks
   that change as "agent". When your editor's PID writes, it marks it
   "you".

Everything else — session cards, token budgets, git diffs, network
records — is derived from these three inputs.

## Pluggable format adapters

The parser treats JSONL variants as plugins. Three adapters ship
today (Claude, Gemini, Codex) under `server/src/parser/`. Adding a
new agent requires:

- An adapter that maps raw JSONL lines to the internal `Message` type
- A discovery glob that finds its session files on disk
- A base URL convention for the proxy if the agent supports one

Core UI components (chat panel, editor, network tab) do not know
which agent produced a message — they render the normalized shape.

## State materialization

The ECS world is the hot in-memory state. Every message, session,
file, task, and agent entity lives there. Systems update components
when events arrive on the bus.

The database is a persistent cache on top of the ECS world:

- Recent messages have FTS5 indexes so Cmd+F is fast
- Sessions, stats, and cost breakdowns cache there
- It can be deleted at any time — the next startup rebuilds it from
  the JSONL files

This design makes recovery simple: if noaide behaves oddly, delete
`$NOAIDE_DB_PATH` and restart.

## The Breathing Orb state machine

| State | PTY signal | JSONL ground truth | UI |
|-------|-----------|--------------------|----|
| IDLE | no output for >2 s | `stop_reason: "end_turn"` | Lavender, 2 s slow pulse |
| THINKING | braille spinner | `type: "thinking"` | Mauve, 0.5 s fast pulse |
| STREAMING | block cursor + text | `stop_reason: null` | Blue, 1 s breathing |
| TOOL_USE | tool-pattern regex | `type: "tool_use"` | Peach, 1.5 s rotate |
| ERROR | stderr or exit != 0 | `is_error: true` | Red, 0.3 s rapid pulse |

The PTY column is an optimistic signal — it transitions the orb fast
so the UI feels reactive. The JSONL column is the source of truth —
the orb snaps to the JSONL state when the write lands, resolving any
disagreement. This is why the transitions sometimes skip a frame:
the PTY was ahead, the JSONL caught up, the reconcile collapsed the
difference.

## Related docs

- [AGENTS.md](../AGENTS.md) — the supervisor contract
- [architecture.md](architecture.md) — components behind this document
- [supervision-boundaries.md](supervision-boundaries.md) — the control surfaces
