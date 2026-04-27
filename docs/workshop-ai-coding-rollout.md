# Workshop — Operating AI Coding Agents in a Regulated Engineering Team

> Forty-five minute hands-on session for engineering leadership, DevSecOps,
> and customer-engineering teams who need to roll out AI coding agents
> (Codex, Claude Code, Gemini CLI) with a working observation, control,
> and evidence story before approving them against production code.

This workshop is tool-agnostic on purpose. The agent the participant
brings — Codex, Claude Code, or Gemini CLI — is not what is being
taught. The goal is to show how the *operator* stays in the loop while
**any** of those agents is running, and what artefacts the team gets
out of a session that survives outside of the workshop.

---

## Audience

- Engineering leadership piloting AI coding agents inside a team.
- DevSecOps writing the rollout checklist and incident playbook.
- Customer-engineering teams asked to put a supervision surface
  around an agent before it is approved against production code.
- Solution architects evaluating how observation + intercept + audit
  fit into existing SIEM and review workflows.

The audience does not need to be a Rust or SolidJS developer. They
do need to be comfortable with shell, TLS, and `gh`/`gcloud`-class
tools.

## Goal

> *"How to roll out AI coding agents in a regulated engineering team —
> observation, control, evidence."*

By the end the participant has:

1. Watched every JSONL event from a real agent session render live.
2. Held an outbound API request, modified it, and forwarded it.
3. Pulled an NDJSON audit log out of a session and walked it end to end.
4. A rollout checklist they can adapt for their own org.

## Pre-flight (5 min)

Before the session starts, confirm each participant has:

- A laptop with Docker (or Podman with the `docker-compose` shim).
- A noaide checkout from `main`. `just certs` and
  `docker compose -f docker-compose.prod.yml up -d --build` must
  complete cleanly.
- One agent installed and reachable on PATH:
  - **Codex**: `codex --version` returns a version, and `OPENAI_API_KEY`
    is set.
  - **Claude Code**: `claude --version` returns a version, and an
    Anthropic API key is configured (`ANTHROPIC_API_KEY` or
    `claude auth login`).
  - **Gemini CLI**: `gemini --version` returns a version, and either
    `gcloud auth application-default login` is done or
    `GOOGLE_API_KEY` is set.
- A TLS chain noaide trusts. mkcert or a corporate CA both work — see
  [`docs/deployment-guide.md`](deployment-guide.md) for the three
  supported sources.

If any of those is missing, fix it before block 1; the demo flow
does not work without them.

## Agenda (45 min)

| Block | Time | Theme |
|---|---|---|
| 1 | 5 min | Why operator-supervision for AI coding agents |
| 2 | 10 min | Setup walkthrough — clone, certs, proxy on |
| 3 | 15 min | Hands-on — spawn a session, inspect the event stream, intercept an API request |
| 4 | 10 min | Evidence-export pattern + audit-trail review |
| 5 | 5 min | Q&A + limitations |

### Block 1 — Why operator-supervision (5 min)

Frame the problem. AI coding agents are autonomous enough to read
files, run shell commands, and call out to providers. Their official
CLIs render ~60% of the JSONL transcript and treat the rest as
internal. Without a supervision surface the team has neither
visibility nor an evidence trail when something goes wrong.

Discussion prompt: *what does your team's incident playbook currently
say when an agent ran away over the weekend?*

### Block 2 — Setup walkthrough (10 min)

Goal: every participant gets noaide running and routes their agent's
API traffic through the proxy.

1. `just certs` (mkcert) and `docker compose -f docker-compose.prod.yml up -d`.
2. Open noaide in a Chromium-based browser; dismiss the welcome.
3. Point your agent at the proxy. Pick the env-var line that matches
   your tool:

   ```bash
   # Codex (OpenAI):
   export OPENAI_BASE_URL="http://localhost:4434/s/${SESSION_ID}/backend-api/codex"

   # Claude Code (Anthropic):
   export ANTHROPIC_BASE_URL="http://localhost:4434/s/${SESSION_ID}"

   # Gemini CLI (Google):
   export CODE_ASSIST_ENDPOINT="http://localhost:4434/s/${SESSION_ID}"
   export GOOGLE_GEMINI_BASE_URL="http://localhost:4434/s/${SESSION_ID}"
   ```

4. Run the agent. The session should appear in the sidebar within
   one second; the Network tab should start collecting requests.

If a participant's setup blocks, do **not** keep the room waiting —
pair the participant with a peer and continue. The block-3 hands-on
is the load-bearing one.

### Block 3 — Hands-on: observe and intercept (15 min)

Goal: convince the participant that nothing the agent does is hidden,
and that they can hold a request before it reaches the provider.

1. Prompt the agent with a non-trivial task — *"rename the `Foo`
   type to `Bar` and update its tests"*.
2. Watch the chat panel render every JSONL event live. Each tool
   surfaces a slightly different vocabulary; all three render in the
   same stream:

   ```text
   Codex            : turn_context · agent_reasoning · agent_message ·
                       response_item · compacted
   Claude Code      : user · assistant · tool_use · tool_result ·
                       system-reminder · compact_summary
   Gemini CLI       : user · model · functionCall · functionResponse ·
                       systemInstruction
   ```

3. Show the system-reminder / system-prompt fields the official UI
   suppresses. noaide renders them in line with the rest of the
   transcript.
4. Switch to the Files tab and show the file events with PID
   attribution. Every change the agent makes appears here in real
   time, attributed to the right process.
5. Switch the proxy mode in the Network tab from **Auto** to
   **Manual**. Prompt the agent again — the next request is held in
   the inspector pane. Edit a header or the body, then **Forward**.
   Repeat once and **Drop** instead; the agent reports the failure
   in plain text.

Discussion prompt: *which requests would your team gate by default,
and which would you let through automatically?*

### Block 4 — Evidence export (10 min)

Goal: produce a deliverable that survives outside the workshop.

1. In the Network tab, switch to **Custom** mode and expand the
   **Audit Log** section.
2. Click **JSON** to download the NDJSON-shaped audit log for the
   session that just ran. Open it side-by-side with the chat panel.
3. Walk it line by line. Each entry maps a captured request and
   response back to a session id, a model, redacted payload, and
   timing.
4. Click **CSV** to export the same data to a spreadsheet.
5. Verify the redaction. `sk-…` keys, `Bearer …` tokens, Anthropic
   session tokens, and Google ADC tokens are all masked in both the
   request list and the exported audit log.

Discussion prompt: *which downstream system would consume this audit
log in your org — SIEM, ticketing, finance, or all three?*

### Block 5 — Q&A and limitations (5 min)

Reserve five honest minutes for questions and the limitations
section below. The biggest miss-step in a customer rollout is
treating noaide as something it isn't.

---

## Safety boundaries — what noaide does NOT enforce

This is the most important section of the workshop. noaide is a
supervision surface, not a policy engine. See
[supervision-boundaries.md](supervision-boundaries.md) for the full
contract; the short version:

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

If the rollout requires **hard runtime policy enforcement** —
deny-list of shell commands, outbound-network firewall scoped to
the agent process, signed and tamper-evident audit logs — pair
noaide with a runtime-governance layer such as
[**project-sentinel**](https://github.com/silentspike/project-sentinel).
noaide gives the operator the visibility to write those layers
correctly; it does not become them.

## Companion repositories

noaide is one piece of a small set of operator tooling. For a fuller
workshop, consider pairing it with:

- [**mainrag**](https://github.com/silentspike/mainrag) — an MCP
  server that gives the agents a shared context layer (project docs,
  conversation history, code search) during the session. Useful when
  the workshop participants want to demo "the same agent with
  different context envelopes" rather than just raw API access.
- [**project-sentinel**](https://github.com/silentspike/project-sentinel)
  — runtime governance layer for the host the agent runs on. The
  one place noaide explicitly cannot fill in; mention it whenever a
  participant asks "but can it *block* a `rm -rf`?"

Both repositories are linked from the limitations and rollout
sections elsewhere on the page.

## Rollout checklist

Use this as a starting point for a customer-facing checklist. Adapt
the wording but keep the categories.

- **TLS provisioning.** LetsEncrypt for public-internet hosts,
  corporate CA for intranet hosts, mkcert only for localhost.
  Document who owns renewal.
- **Secret hygiene.** `NOAIDE_JWT_SECRET` is the only secret noaide
  generates; rotate via secret manager. Audit log volumes contain
  redacted bodies — store them in the same tier as access logs, not
  the public artefact tier.
- **Network policy.** Egress whitelist for `OPENAI_BASE_URL`,
  `ANTHROPIC_BASE_URL`, `CODE_ASSIST_ENDPOINT`, and
  `GOOGLE_GEMINI_BASE_URL`. Block direct access to provider
  endpoints from the agent host so the proxy is always on the path.
- **Backup.** Audit log NDJSON volume goes to whichever long-term
  store the org already uses for SIEM input. The Limbo cache is
  regenerable and does not need a backup policy.
- **Role separation.** The operator user that reads the audit log
  must not be the same identity the agent uses to call providers.
  Same machine is fine; same login is not.
- **Browser scope.** Pre-alpha is Chromium only (ADR-001). Document
  the Chrome / Edge / Brave / Arc / Opera support and the explicit
  Firefox / Safari gap.
- **Runtime governance.** If the rollout needs a kernel-level shell
  sandbox or signed audit, pair with project-sentinel before
  approving the agent against production code.

## Failure modes — extended notes

The three failure modes block 3 rehearses, plus two more the
participant will probably hit within their first week.

### eBPF capabilities are missing

Symptom: the file events panel shows no PID attribution and the
backend logs `eBPF unavailable, falling back to inotify`.

Cause: the host kernel does not expose `CAP_BPF`, the container does
not get it, or the kernel is too old.

Recovery: container `--cap-add=BPF --cap-add=PERFMON` for kernels
≥ 5.8, or `--cap-add=SYS_ADMIN` for older kernels. inotify is a
working fallback; PID attribution is the only thing you lose.

### A provider changes its rollout schema

Symptom: a new top-level `type` appears in the JSONL that noaide
preserves as a generic meta event instead of rendering it natively.

Cause: a provider extended the schema. noaide is forward-tolerant —
it will not drop the line, but the visual rendering may not be
ideal.

Recovery: open an issue with the new event type and a sanitized
sample. The parser hot path is small — Codex parsing lives in
`server/src/parser/codex.rs`, Claude in `server/src/parser/jsonl.rs`,
Gemini in `server/src/parser/gemini.rs`. Adding a new branch is a
single function.

### The proxy is bypassed

Symptom: an agent session shows up in the sidebar but no requests
appear in the Network tab.

Cause: the agent connected directly to the provider instead of the
proxy. The most common reason is a missing base-URL export in the
shell that started the agent
(`OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` /
`CODE_ASSIST_ENDPOINT` / `GOOGLE_GEMINI_BASE_URL`).

Recovery: re-export the base URL and restart the agent. Add the
egress whitelist from the rollout checklist so this is caught at
the network layer next time.

### TLS chain breaks during rotation

Symptom: WebTransport disconnects in the browser; the agent's calls
to the proxy fail with a TLS error.

Cause: cert renewed, server restarted with old cert path, or the
intermediate is missing from the chain.

Recovery: confirm `NOAIDE_TLS_CERT` and `NOAIDE_TLS_KEY` point at the
new pair. Restart the noaide-server. Re-trust the new certificate in
the agent's environment (`NODE_EXTRA_CA_CERTS` for Claude / Gemini,
`CODEX_CA_CERTIFICATE` for Codex).

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
   class of request, and which agent the team rolls out first.

If any of those three is missing at the end of the workshop, the
rollout is not yet ready.

## Demo data

The seeded fixtures under
[`frontend/e2e/fixtures/`](../frontend/e2e/fixtures/) contain a
sanitised Codex rollout, a Claude session sample, and a Gemini
chat. They are deterministic; the workshop facilitator can rerun
the hands-on segment against them when an internet-blocked
environment makes a live agent run impractical.
