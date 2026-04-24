# HTTP API Reference

noaide's backend exposes an HTTP/1.1 API on port `8080` (configurable
via `NOAIDE_HTTP_PORT`) for control-plane operations. The streaming
data plane is WebTransport on port `4433`; this document only covers
the HTTP surface.

All endpoints are implemented in
[`server/src/main.rs`](../server/src/main.rs) unless noted otherwise.
Paths may evolve while the project is in pre-alpha.

## Conventions

- JSON bodies unless stated otherwise
- `Content-Type: application/json` on POST/PUT
- UUIDs for session IDs, kebab-case for other identifiers
- CORS is same-origin; the dev proxy on :9999 routes `/api/*` to :8080
- Errors return a JSON body with `{"error": "...", "detail": "..."}`

## Server metadata

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | `200 OK` plaintext when the server is ready |
| GET | `/api/server-info` | Build info: version, git sha, enabled feature flags |

## Sessions

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sessions` | List all discovered sessions (observed + managed) |
| POST | `/api/sessions/managed` | Spawn a managed session with a specific agent + command |
| GET | `/api/sessions/{id}` | Full session detail (metadata, agent type, paths) |
| GET | `/api/sessions/{id}/messages` | Parsed JSONL messages with pagination |
| GET | `/api/sessions/{id}/stats` | Token counts, model breakdown, duration |
| GET | `/api/sessions/{id}/files` | Files touched during this session |
| POST | `/api/sessions/{id}/input` | Send raw bytes to the PTY / tmux pane |
| POST | `/api/sessions/{id}/send` | Send a user message (includes newline handling) |
| POST | `/api/sessions/{id}/append` | Append to the JSONL without driving input |
| POST | `/api/sessions/{id}/images` | Attach images to the next message |
| POST | `/api/sessions/{id}/close` | Stop a managed session |

The `/input` and `/send` split is important: `send` implements the
per-agent handshake (Gemini splits text and newline by 30 ms because
Ink TUIs otherwise eat the newline), while `input` is a raw pipe.

## Filesystem

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/files?path=…` | Read a file (text, returned as `{content, sha}`) |
| GET | `/api/browse?path=…` | Directory listing for the File tree |

## Git

All git routes operate on the project the session is inside.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/git/branches` | Local + remote branches, current HEAD |
| GET | `/api/git/status` | Working-tree status (staged + unstaged) |
| GET | `/api/git/log` | Paginated commit log |
| GET | `/api/git/blame` | Per-line blame for a file |
| GET | `/api/git/diff-hunks` | Hunk-level diff of the working tree |
| GET | `/api/git/prs` | Open PRs (uses `gh` CLI if available) |
| POST | `/api/git/stage` | Stage a file |
| POST | `/api/git/stage-hunk` | Stage a specific hunk |
| POST | `/api/git/unstage` | Unstage a file |
| POST | `/api/git/commit` | Commit the staged set |
| POST | `/api/git/checkout` | Switch branch |

## Plans (TOGAF)

The plan subsystem backs the TOGAF panel.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/plans` | List available plans under `/work/plan/` |
| GET | `/api/plans/{name}/plan.json` | The raw plan JSON |
| POST | `/api/plans/{name}/edits` | Append an edit to `plan-edits.json` |

## Proxy (API recorder)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/proxy/requests?session_id=…` | Recorded request/response pairs |
| GET | `/api/proxy/audit` | Full audit log (rotated) |
| GET | `/api/proxy/audit/export` | Download the audit as NDJSON |
| GET/POST | `/api/proxy/keys` | Manage redaction keys |
| GET | `/api/proxy/keys/status` | Status of currently installed keys |
| GET/POST | `/api/proxy/presets` | Preset configurations for proxy behaviour |

The forwarding side lives at `/s/{uuid}/...` and is handled in
[`server/src/proxy/`](../server/src/proxy/); it is not an `/api/*`
route.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ca.pem` / `/api/ca.crt` | Local mkcert root CA for proxy trust |

## Teams

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/teams` | List team names |
| GET | `/api/teams/{name}/tasks` | Task board for a team |
| GET | `/api/teams/{name}/topology` | Force-directed graph data |

## WebSocket

| Method | Path | Purpose |
|--------|------|---------|
| WS | `/api/ws/transcribe` | Voice-to-text streaming (proxies to the Whisper sidecar on `:8082`) |

The Whisper sidecar (`server/whisper/server.py`) is a separate Python
process. The Rust server forwards PCM frames from the browser and
streams back partial + final transcripts.

## Related docs

- [architecture.md](architecture.md) — how HTTP fits into the wider system
- [../AGENTS.md](../AGENTS.md) — supervisor contract these routes serve
