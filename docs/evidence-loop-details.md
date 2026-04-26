# Evidence and Audit Loop — Implementation Details

> Companion to [AGENTS.md §3 Evidence and Audit Loop](../AGENTS.md#3-evidence-and-audit-loop).
> AGENTS.md describes *what* the supervisor sees; this document
> describes *how* the underlying mechanics work.

## EventEnvelope

Every event that crosses a component boundary in the server is wrapped
in an `EventEnvelope`. This is the wire-level type the bus, the ECS
update systems, and the transport all see.

```rust
pub struct EventEnvelope {
    pub event_id: Uuid,
    pub source: EventSource,           // JSONL | PTY | Proxy | Watcher | User
    pub sequence: u64,                 // Monotonic per source
    pub logical_ts: u64,               // Lamport clock — global ordering
    pub wall_ts: i64,                  // Unix timestamp (millis)
    pub session_id: SessionId,
    pub dedup_key: Option<String>,     // Echo deduplication
}
```

### Lamport clock

The `logical_ts` is a [Lamport clock](https://lamport.azurewebsites.net/pubs/time-clocks.pdf):
a single monotonically-increasing counter shared across all sources,
incremented on every `publish()` call to the bus. Properties:

1. **Total order across sources.** Two events from the file watcher
   and the JSONL parser can be ordered against each other even though
   they come from different threads with no shared wall clock.
2. **Causality.** If event A causes event B (e.g., a PTY write causes
   a JSONL append), `A.logical_ts < B.logical_ts` — the receiver of B
   knows it happened *after* A.
3. **Resync after restart.** On startup the counter is restored from
   the highest persisted value plus a constant, so events written
   pre-restart are guaranteed to sort before events written
   post-restart.

The wall clock (`wall_ts`) is *not* used for ordering — it is for
display only. Wall clocks drift, NTP can step backwards, and two
sources rarely agree to millisecond precision.

### Sequence numbers

`sequence` is monotonic *per `source`*. The frontend uses the pair
(`source`, `sequence`) to detect dropped events: if it sees JSONL
events with sequences `[100, 101, 103]`, it knows event 102 was lost
in transit and can request a refetch.

Bounded channels in the bus drop oldest-first when full
(`file.change` topic with capacity 500), which is when sequence gaps
appear in practice. The frontend reports this via the profiler panel.

### Deduplication keys

The PTY input path causes an echo problem: the supervisor types
something, the PTY consumes it, the agent writes it to the JSONL.
The file watcher then sees the JSONL change and emits a
`message.new` event — but the chat panel already optimistically
appended the typed message.

`dedup_key` solves this. When the supervisor's typed message is sent,
the optimistic UI append carries a key like `pty:<session_id>:<line_hash>`.
When the JSONL-derived event arrives, it carries the same key. The ECS
update system sees the duplicate and merges instead of duplicating.

The key is `Option<String>` because most events do not need
deduplication — only the PTY-input-then-JSONL-echo pattern does.

## Persistence layers

```
                     ┌──────────────────────────┐
                     │   JSONL on disk          │   ← source of truth (agent owns)
                     └─────────┬────────────────┘
                               │ parse on file change
                               ▼
                     ┌──────────────────────────┐
                     │   Limbo SQLite DB        │   ← regeneratable cache + FTS5
                     └─────────┬────────────────┘
                               │ load on startup
                               ▼
                     ┌──────────────────────────┐
                     │   ECS world (in-memory)  │   ← hot path, struct-of-arrays
                     └─────────┬────────────────┘
                               │ render
                               ▼
                     ┌──────────────────────────┐
                     │   Browser (SolidJS)      │   ← receives EventEnvelope frames
                     └──────────────────────────┘
```

Each downstream layer is **regeneratable** from the layer above it.
This is the core property the audit loop relies on: if anything
goes wrong (DB corruption, ECS desync, browser-side staleness), the
recovery is "drop the stale layer and rebuild from the layer above."

| Layer | Owner | Lifetime | Recovery |
|-------|-------|---------|----------|
| JSONL | Agent process | Permanent (the agent decides) | Cannot regenerate; this is the truth |
| Limbo DB | noaide-server | Until volume is wiped | `rm $NOAIDE_DB_PATH && restart` |
| ECS world | noaide-server (in-memory) | Until process restart | Process restart triggers rebuild from DB |
| Browser state | SolidJS | Until tab refresh | Tab refresh triggers re-fetch from server |

## Audit log (proxy)

The API proxy records every request/response pair in the Limbo
database under the `proxy_audit` table. This is the one piece of
durable state that is *not* regeneratable — once the agent has made
a request, the only record of it is in this table.

### Schema

```sql
CREATE TABLE proxy_audit (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id    TEXT NOT NULL,                     -- UUID v4
    session_id    TEXT NOT NULL,                     -- session UUID
    upstream      TEXT NOT NULL,                     -- "api.anthropic.com" | …
    method        TEXT NOT NULL,
    path          TEXT NOT NULL,
    request_body  TEXT NOT NULL,                     -- redacted, NDJSON-safe
    request_ts    INTEGER NOT NULL,                  -- millis
    response_status INTEGER,
    response_body TEXT,                              -- redacted
    response_ts   INTEGER,
    latency_ms    INTEGER,
    intercept_mode TEXT NOT NULL,                    -- "auto" | "manual"
    forward       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX proxy_audit_session ON proxy_audit(session_id, request_ts);
```

### NDJSON export format

`GET /api/proxy/audit/export` streams the table as newline-delimited
JSON, one row per line:

```json
{"id":1,"request_id":"…","session_id":"…","upstream":"api.anthropic.com","method":"POST","path":"/v1/messages","request_body":"{…redacted…}","request_ts":1714123456789,"response_status":200,"response_body":"{…}","response_ts":1714123457123,"latency_ms":334,"intercept_mode":"auto","forward":1}
{"id":2,…}
```

NDJSON is chosen so that audit copies can be:
- `grep`'d for a session_id
- `jq`'d for a specific upstream
- imported into ELK / Splunk / Datadog with one config line

### Rotation

Rotation is by row count, not by file — there is no separate file
artefact, the rows live in the same Limbo database as the rest of
the cache. The retention policy is currently "keep the last 50000
rows per session" (configurable via `NOAIDE_PROXY_AUDIT_RETAIN`,
default at compile time). Rows older than the threshold are pruned
at write time.

For long-term retention, run `GET /api/proxy/audit/export` on a cron
and pipe the output to your log archive of choice.

### Redaction (recap)

The same regex patterns from
[docs/security-deep-dive.md — Secret redaction](security-deep-dive.md#secret-redaction)
are applied **before** rows are written. A row that has been written
to the audit table has already had `sk-ant-*` and `Bearer *` stripped.
There is no "raw audit table" hidden behind the redacted one — the
redaction is at the write boundary, not at the read boundary.

## File-event attribution

The eBPF watcher exposes the writing PID for every observed event.
The ECS update system maps that PID to a `Source`:

| PID matches | Source |
|-------------|--------|
| The supervisor's editor process (parent of the user shell) | `User` |
| A managed session's child process | `Agent { session_id }` |
| Anything else | `Unknown` |

The Source goes into the EventEnvelope. The chat panel and the file
tree use it to colour-code edits. When the watcher falls back to
inotify, PID attribution is lost and every event becomes `Unknown` —
this is visible to the supervisor as a warning toast.

## Reading the audit trail

For a given session, four queries answer "what happened":

```bash
# 1. All chat messages, in Lamport order
sqlite3 $NOAIDE_DB_PATH \
  "SELECT logical_ts, role, content_preview FROM messages WHERE session_id='UUID' ORDER BY logical_ts"

# 2. All file events the agent caused
sqlite3 $NOAIDE_DB_PATH \
  "SELECT logical_ts, path, kind FROM file_events
   WHERE session_id='UUID' AND source='Agent' ORDER BY logical_ts"

# 3. All API calls
curl -s 'http://localhost:8080/api/proxy/audit/export?session_id=UUID' | jq -c

# 4. Tool-use envelopes (subset of messages)
sqlite3 $NOAIDE_DB_PATH \
  "SELECT logical_ts, content_preview FROM messages
   WHERE session_id='UUID' AND content_preview LIKE '%tool_use%'"
```

The four together reconstruct the agent's full activity timeline,
ordered by Lamport clock, with secrets redacted.

## See also

- [AGENTS.md §3](../AGENTS.md#3-evidence-and-audit-loop) — supervisor view
- [docs/architecture.md — Threading and concurrency](architecture.md#threading-and-concurrency)
- [docs/security-deep-dive.md](security-deep-dive.md)
- [docs/api.md — Proxy endpoints](api.md#proxy-api-recorder)
- ADRs in [llms.txt](../llms.txt)
