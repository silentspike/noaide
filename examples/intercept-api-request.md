# Intercept an API request before it leaves the host

Goal: switch the proxy to manual mode, hold the next outbound
request from any agent, edit it, and forward — or drop it.

## 1. Make sure the agent is routed through the proxy

Either of these env-var sets is enough (see
[`codex-session-spawn.md`](codex-session-spawn.md) for the full
list):

```bash
export OPENAI_BASE_URL="http://localhost:4434/s/${SESSION_ID}/backend-api/codex"
# or
export ANTHROPIC_BASE_URL="http://localhost:4434/s/${SESSION_ID}"
# or
export CODE_ASSIST_ENDPOINT="http://localhost:4434/s/${SESSION_ID}"
export GOOGLE_GEMINI_BASE_URL="http://localhost:4434/s/${SESSION_ID}"
```

## 2. Switch the proxy to manual mode

In the noaide UI, open the **Network** tab and click **Manual** in
the mode bar. The mode now reads `manual` for every new request.

Source: [`server/src/proxy/handler.rs`](../server/src/proxy/handler.rs)
(see `intercept_mode`).

## 3. Issue a request from the agent

In the same shell where the agent runs:

```text
codex
> List the open issues in this repo and pick the one with the most
  +1 reactions.
```

The agent assembles a request and hits the proxy. The proxy holds
the request and surfaces it in the **Network** tab inspector.

## 4. Edit the held request

The inspector shows headers and body in editable form. Common edits:

- Change the model header (`x-model: claude-3.5-sonnet` →
  `x-model: claude-3.5-haiku`) to compare cost.
- Strip a tool from the `tools` array in the body to test the
  agent's fallback behaviour.
- Inject a `system` message at the top of `messages` to add
  operator-side context.

Click **Forward** to release the modified request. The agent sees
the response normally and continues.

## 5. Try the drop path

Issue another prompt. When the request lands in the inspector,
click **Drop** instead of **Forward**.

Expected: the agent receives a 503 / connection-reset and reports
the failure in plain text. It does not retry against the upstream;
the proxy did not pass the request along.

## 6. Confirm the redaction

Click on a captured request in the list, open the body view, and
search for `sk-`, `Bearer `, or your provider account id. Source:
[`server/src/proxy/handler.rs`](../server/src/proxy/handler.rs)
(see `redact_secrets`).

Expected output:

```text
Authorization: Bearer ***
x-api-key: sk-ant-***
```

The redaction runs before the request enters the audit log and
before it appears in the UI. The actual upstream request is sent
with the original credentials.

## See also

- [`audit-export-pattern.md`](audit-export-pattern.md) — pull the
  NDJSON audit log of the session you just intercepted
- [`docs/supervision-boundaries.md`](../docs/supervision-boundaries.md)
  — the contract between operator and agent that this gate enforces
