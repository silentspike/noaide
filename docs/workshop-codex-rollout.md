# Workshop — Operating Codex with noaide

> Forty-five minute hands-on session for engineering leads and
> trust-and-deployment specialists who need to validate Codex sessions
> as a deployment-grade workflow before rolling them out across an
> organisation.

This workshop assumes a Codex installation that the participant
controls and a noaide instance running on the participant's laptop or
on a small shared host. The goal is not to teach Codex; the goal is to
show how the operator stays in the loop while Codex is running.

---

## Audience

- Engineering leads piloting Codex inside a team.
- Trust-and-deployment specialists writing the rollout checklist for
  Codex (or Claude Code, or Gemini CLI).
- Solution architects asked to put a supervision surface around an
  agent before it is approved for use against production code.

The audience does not need to be a Rust or SolidJS developer. They do
need to be comfortable with shell, TLS, and `gh`/`gcloud`-class tools.

## Pre-flight (5 min)

Before the session starts, confirm each participant has:

- A laptop with Docker (or Podman with the `docker-compose` shim).
- A noaide checkout from `main`. `just certs` and
  `docker compose -f docker-compose.prod.yml up -d --build` must
  complete cleanly.
- A Codex installation (`codex --version` should return a version).
- A TLS chain noaide trusts. mkcert or a corporate CA both work — see
  `docs/deployment-guide.md` for the three supported sources.
- A working API key for Codex (or another OpenAI-compatible provider)
  exported as `OPENAI_API_KEY`.

If any of those is missing, fix it before block 1; the demo flow does
not work without them.

## Agenda

The four blocks below add up to forty minutes. The remaining five
minutes are for the pre-flight check above and a closing review.

### Block 1 — Observation (10 min)

Goal: convince the participant that nothing the agent does is hidden.

1. Spawn a Codex session normally (no proxy, no special env).
2. Open the noaide UI in Chromium at the URL the deployment guide
   prints. Pick the new session card from the sidebar.
3. As the participant prompts Codex with a non-trivial task ("rename
   the `Foo` type to `Bar` and update its tests"), watch the chat
   panel render every JSONL event live: `turn_context`,
   `agent_reasoning`, `agent_message`, `response_item`,
   `compacted` summaries.
4. Show the `system-reminder` and provider transcript fields. The
   official Codex CLI usually suppresses them; noaide does not.
5. Switch to the Files tab and show eBPF or inotify file events with
   PID attribution. Every change the agent makes shows up here, in
   real time, attributed to the right process.

Discussion prompt: *if your team adopts Codex tomorrow, who reads
this transcript and how often?*

### Block 2 — Intercept and gate (10 min)

Goal: show that the operator can hold and modify a request before it
leaves the host.

1. Restart Codex with the noaide proxy:

   ```bash
   export OPENAI_BASE_URL="http://localhost:4434/s/${SESSION_ID}/backend-api/codex"
   export OPENAI_API_KEY=…
   codex
   ```

2. In the noaide Network tab, switch the proxy mode from **Auto** to
   **Manual**.
3. Prompt Codex again. The next request will be held in the manual
   gate; the request body shows up in the inspector pane.
4. Modify a header, edit the body, then **Forward**. Codex receives
   the modified request and continues.
5. Repeat once more, but this time **Drop** the request. Codex sees
   the failure and reports it back to the participant in plain
   English.

Discussion prompt: *which requests would your team gate by default,
and which would you let through automatically?*

### Block 3 — Failure modes (10 min)

Goal: rehearse the three most common failure modes so they are not
surprises when they happen in production.

1. **Cert chain broken.** Replace `certs/cert.pem` with a wrong
   certificate and reload the page. The browser console shows the
   exact failure. Walk through the `NODE_EXTRA_CA_CERTS` /
   `CODEX_CA_CERTIFICATE` / `SSL_CERT_FILE` recovery in
   `docs/deployment-guide.md`.
2. **Proxy crash.** `kill -9` the noaide-server process. Codex falls
   back to the upstream depending on env variables; observe what the
   participant's checklist should say about that fallback.
3. **Unknown JSONL event.** Append a synthetic line with an unknown
   `type` to a fixture and observe how noaide preserves it as a
   meta event instead of dropping it. The transcript stays
   loss-free even when a provider extends its schema.

Discussion prompt: *how does your incident playbook reference each
of these failure modes today?*

### Block 4 — Audit export and review (10 min)

Goal: produce a deliverable that survives outside the workshop.

1. Open the Network tab → Custom mode → expand **Audit Log**.
2. Click **JSON** to download the NDJSON-shaped audit log for the
   session that just ran.
3. Walk through the JSON line by line. Each entry maps a captured
   request and response back to a session id, a model, a redacted
   payload, and timing.
4. Show the same data exported as CSV via the **CSV** button.
5. Check the redaction. `sk-…` keys, `Bearer …` tokens, and
   provider account ids are masked in both the on-screen request
   list and the exported audit log.

Discussion prompt: *which downstream system would consume this audit
log in your org — SIEM, ticketing, finance, or all three?*

---

## Safety boundaries — what noaide does NOT enforce

This is the most important section of the workshop. noaide is a
supervision surface, not a policy engine. See
[supervision-boundaries.md](supervision-boundaries.md) for the full
contract, but at a glance:

- noaide does **not** mediate tool execution. When the agent runs a
  shell command, it runs on the host. noaide records it.
- noaide does **not** prevent the agent from reading files. It tells
  the operator which files the agent read, and when.
- noaide does **not** filter agent output. It renders everything the
  JSONL contains.
- noaide does **not** sign, encrypt, or attest the audit log. If the
  audit log volume is mutable, treat it as advisory.
- noaide does **not** replace the operator. If nobody reads the
  audit log, the audit log is just storage.

If the rollout requires hard policy enforcement (deny-list of shell
commands, outbound-network firewall, signed audit) the team needs to
add those layers around noaide. noaide gives the operator the visibility
to write those layers correctly; it does not become them.

## Rollout checklist

Use this as a starting point for a customer-facing checklist. Adapt
the wording but keep the categories.

- **TLS provisioning.** LetsEncrypt for public-internet hosts,
  corporate CA for intranet hosts, mkcert only for localhost. Document
  who owns renewal.
- **Secret hygiene.** `NOAIDE_JWT_SECRET` is the only secret noaide
  generates; rotate via secret manager. Audit log volumes contain
  redacted bodies — store them in the same tier as access logs, not
  the public artefact tier.
- **Network policy.** Egress whitelist for `OPENAI_BASE_URL`,
  `ANTHROPIC_BASE_URL`, and `CODE_ASSIST_ENDPOINT`. Block direct
  access to provider endpoints from the agent host so the proxy is
  always on the path.
- **Backup.** Audit log NDJSON volume goes to whichever long-term
  store the org already uses for SIEM input. The Limbo cache is
  regenerable and does not need a backup policy.
- **Role separation.** The operator user that reads the audit log
  must not be the same identity the agent uses to call providers.
  Same machine is fine; same login is not.
- **Browser scope.** Pre-alpha is Chromium only (ADR-001). Document
  the Chrome / Edge / Brave / Arc / Opera support and the explicit
  Firefox / Safari gap.

## Failure modes — extended notes

These are the three failure modes block 3 rehearses, plus two more
the participant will probably hit within their first week.

### eBPF capabilities are missing

Symptom: the file events panel shows no PID attribution and the
backend logs `eBPF unavailable, falling back to inotify`.

Cause: the host kernel does not expose `CAP_BPF`, the container does
not get it, or the kernel is too old.

Recovery: container `--cap-add=BPF --cap-add=PERFMON` for kernels
≥ 5.8, or `--cap-add=SYS_ADMIN` for older kernels. inotify is a
working fallback; PID attribution is the only thing you lose.

### Codex changes its rollout schema

Symptom: a new top-level `type` appears that noaide preserves as a
generic meta event instead of rendering it natively.

Cause: provider extended the schema. noaide is forward-tolerant; it
will not drop the line, but the visual rendering may not be ideal.

Recovery: open an issue with the new event type and a sanitized
sample. The parser hot-path is small; adding a new branch is a
single function in `server/src/parser/codex.rs`.

### The proxy is bypassed

Symptom: a Codex session shows up in the sidebar but no requests
appear in the Network tab.

Cause: the agent connected directly to the provider instead of the
proxy. The most common reason is a missing `OPENAI_BASE_URL` export
in the shell that started the agent.

Recovery: re-export `OPENAI_BASE_URL` and restart the agent. Add the
egress whitelist mentioned in the rollout checklist so this is
caught at the network layer next time.

### TLS chain breaks during rotation

Symptom: WebTransport disconnects in the browser; the agent's calls
to the proxy fail with a TLS error.

Cause: cert renewed, server restarted with old cert path, or the
intermediate is missing from the chain.

Recovery: confirm `NOAIDE_TLS_CERT` and `NOAIDE_TLS_KEY` point at the
new pair. Restart the noaide-server. Re-trust the new certificate in
the agent's environment if it pins via `NODE_EXTRA_CA_CERTS` or
`CODEX_CA_CERTIFICATE`.

### Audit log volume fills up

Symptom: noaide-server logs that the audit insert failed and the
Network tab keeps showing recent requests but the export endpoint
returns truncated data.

Cause: NDJSON volume is full or the underlying disk is.

Recovery: rotate the audit log volume into long-term storage, then
truncate. Until rotation is automated, monitor disk usage on the
volume separately from the server health endpoint.

## Closing — what to take home

Three artefacts that should leave the workshop with the participant:

1. The audit-log NDJSON from block 4, pinned in the org's secure
   storage as the first sample.
2. The rollout checklist above, adapted to the org's stack and
   pasted into the customer-facing runbook.
3. One concrete decision: which proxy mode is the default for which
   class of request.

If any of those three is missing at the end of the workshop, the
rollout is not yet ready.
