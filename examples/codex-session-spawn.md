# Spawn a managed agent session

Goal: launch any of Codex / Claude Code / Gemini CLI against the
noaide proxy, see the session show up in the sidebar, watch the JSONL
event stream render live.

## 1. Allocate a session id

```bash
SESSION_ID=$(uuidgen)
echo "session: $SESSION_ID"
```

The id is opaque; noaide uses it to namespace proxy traffic per
session. Any UUID works.

## 2. Point the agent at the proxy

Pick the env-var line that matches your tool. The proxy listens on
`localhost:4434` by default (`NOAIDE_PORT`).

```bash
# Codex (OpenAI):
export OPENAI_BASE_URL="http://localhost:4434/s/${SESSION_ID}/backend-api/codex"

# Claude Code (Anthropic):
export ANTHROPIC_BASE_URL="http://localhost:4434/s/${SESSION_ID}"

# Gemini CLI (Google):
export CODE_ASSIST_ENDPOINT="http://localhost:4434/s/${SESSION_ID}"
export GOOGLE_GEMINI_BASE_URL="http://localhost:4434/s/${SESSION_ID}"
```

The proxy detects the provider from the request path and forwards to
the real endpoint. Source: [`server/src/proxy/handler.rs`](../server/src/proxy/handler.rs).

## 3. Run the agent

```bash
codex                # or: claude  /  gemini
> Add a unit test for the rate limiter and run it.
```

The agent runs as usual. noaide does not wrap it — the proxy sits in
front of the API call only.

## 4. Confirm the session is registered

```bash
wget -qO - http://localhost:8080/api/sessions \
  | python3 -c "import json,sys; print('\n'.join(s['id'] for s in json.load(sys.stdin)))"
```

Expected: a line with the session UUID. If empty, the proxy did not
see traffic — re-export the base URL and rerun.

## 5. Watch the JSONL stream in the browser

Open `https://localhost:9999/noaide/` (or whichever URL the
deployment guide printed) in a Chromium-based browser. The new
session appears in the left sidebar within ~1 s of the first
agent reply.

The chat panel renders every event in the transcript:

```text
Codex            : turn_context · agent_reasoning · agent_message · response_item · compacted
Claude Code      : user · assistant · tool_use · tool_result · system-reminder
Gemini CLI       : user · model · functionCall · functionResponse · systemInstruction
```

The events that the official CLI usually suppresses (system
reminders, intermediate transcript fragments) render in line with
the rest.

## 6. Stop the session

`Ctrl-C` the agent. The session card stays in the sidebar with a
final state — the JSONL on disk is the source of truth, so the
sidebar entry survives a noaide restart.

## See also

- [`intercept-api-request.md`](intercept-api-request.md) — modify a
  request before it leaves the host
- [`audit-export-pattern.md`](audit-export-pattern.md) — pull the
  audit log NDJSON for the session you just spawned
- [`docs/agent-operating-model.md`](../docs/agent-operating-model.md)
  — managed vs observed sessions
