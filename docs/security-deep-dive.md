# Security Deep-Dive

> Companion to [SECURITY.md](../SECURITY.md). SECURITY.md is the
> public-facing summary; this document is the implementation-detail
> view for security reviewers.

## Threat model

noaide is a **local developer tool**, not a multi-tenant service.
The threat actors we model are:

| Actor | Capability | What we mitigate |
|-------|-----------|-----------------|
| Curious user | Reads memory, logs, network | Secret redaction; structured logs without raw bodies |
| Malicious dependency | Code in build path | cargo-audit + pnpm-audit gate the dep tree |
| Malicious agent process | Same UID as noaide | We do not promise sandboxing; agent runs with user privileges |
| Network adversary | Can MITM proxy traffic | TLS 1.3 (QUIC) for the dev server; bring-your-own valid CA in production |
| Browser-side script injection | XSS via untrusted message rendering | SolidJS auto-escape + production CSP `script-src 'self'` |

We **do not** model:
- A nation-state with kernel-level capability (eBPF in our stack is not a hostile component, it is a tool we use)
- A user with root who deliberately bypasses the proxy
- Browsers older than current Chromium (transport simply does not connect)

## Secret redaction

Two patterns are stripped from every log line and every Network-tab
record before they leave the server:

| Pattern | Source | Example |
|---------|--------|---------|
| `sk-ant-[A-Za-z0-9_-]+` | Anthropic API keys | `sk-ant-api03-…` → `***` |
| `Bearer [A-Za-z0-9_.~+/=-]+` | Generic auth headers | `Bearer eyJ…` → `Bearer ***` |

Implementation lives in `server/src/proxy/handler.rs` (request/response
path) and the structured-logging layer wraps every `info!`/`warn!`
call. The redaction runs **before** the audit log is persisted, so
even a compromised log volume cannot leak keys.

The patterns are intentionally simple. Anthropic-format and
Bearer-token coverage is sufficient for the upstreams we forward to
(Anthropic, Gemini, OpenAI). Adding new patterns is a one-line change
in the regex set.

## eBPF trust model

The eBPF watcher uses [aya](https://github.com/aya-rs/aya) to load a
small program (`server/src/watcher/ebpf.rs`) that observes `inotify`
events with PID attribution. The trust model is:

1. **Pre-compiled, never user-supplied.** The `.bpf.o` object is
   built at compile time and embedded into the server binary. There
   is no runtime path that loads bytecode from disk or from the
   network.
2. **Verifier-checked at load time.** The Linux kernel BPF verifier
   rejects programs with unbounded loops, out-of-bounds memory
   access, or unsafe pointer arithmetic. We rely on this check.
3. **No write capability.** The program exposes a ring buffer that
   the userspace consumer reads. There is no map or helper that lets
   the program write to user memory or the filesystem.
4. **Falls back gracefully.** If `CAP_BPF` is missing or the program
   fails to attach, the watcher transparently switches to plain
   inotify (`server/src/watcher/fallback.rs`). PID attribution is
   then lost but observation continues.

This puts noaide in the conservative tier of eBPF use — no XDP, no
syscall hooks, no LSM hooks, no overhead-sensitive networking
programs. The risk surface is limited to "eBPF program compiled by
us, attached at startup, observing inotify".

## Production HTTP headers (CSP, COOP, COEP, …)

When the server is started with `NOAIDE_STATIC_DIR` (production mode,
see [ADR-001](adr/001-production-deployment.md)), it adds a tower
middleware stack that injects:

```
Content-Security-Policy: default-src 'self';
                         script-src 'self';
                         style-src 'self' 'unsafe-inline';
                         img-src 'self' data: blob:;
                         font-src 'self';
                         connect-src 'self' wss: https://api.anthropic.com
                                            https://cloudcode-pa.googleapis.com
                                            https://chatgpt.com;
                         worker-src 'self' blob:;
                         object-src 'none';
                         base-uri 'self';
                         frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=31536000
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

### Rationale per header

- **`script-src 'self'`** — no inline `<script>`, no `eval`. SolidJS
  templates produce zero inline JS by default.
- **`style-src 'self' 'unsafe-inline'`** — SolidJS components use the
  `style={{...}}` prop for dynamic styling. Removing `'unsafe-inline'`
  would break the chat panel's adaptive layout.
- **`connect-src 'self' wss: …`** — covers the WebTransport stream
  to our own backend plus the three LLM upstreams that the proxy
  forwards to. Every other host is blocked.
- **`worker-src 'self' blob:`** — the WASM workers (jsonl-parser,
  markdown, compress) are loaded from the same origin; blob: covers
  the dynamic worker-init pattern.
- **COOP `same-origin` + COEP `require-corp`** — required for
  `crossOriginIsolated`, which is the precondition for
  `SharedArrayBuffer` in the WASM workers.
- **HSTS, nosniff, no-referrer** — defense-in-depth against
  downgrade, MIME-sniff, and referrer leakage.

### Verification

A dedicated workflow at `.github/workflows/prod-smoke.yml` runs the
production stack on every push and asserts each header is present
with the expected value. If a future change accidentally drops a
header, the smoke test fails before merge.

## API proxy whitelist

The proxy hard-codes three upstreams:

```
api.anthropic.com
cloudcode-pa.googleapis.com
chatgpt.com
```

Any other host returns 502. The whitelist is in
`server/src/proxy/handler.rs`; adding an entry requires a code change
and a PR review.

The proxy is also session-scoped: the URL is `/s/{session_uuid}/...`,
which means an attacker who guesses an upstream path still needs a
valid session UUID before the request is forwarded.

## CORS and CSRF

- **CORS**: dev server is same-origin (`localhost:9999`). Production
  server is same-origin by construction (frontend served from the
  same axum process). Cross-origin requests get the default Tower
  CorsLayer behaviour.
- **CSRF**: the API uses JWT auth + same-origin requests. There is
  no cookie-auth path. The classic CSRF attack vector (a malicious
  page submits a form to our origin) does not apply.

## Audit log

Every request and response that flows through the proxy is recorded
in NDJSON form in the Limbo database (table `proxy_audit`). The schema
is documented in [docs/evidence-loop-details.md](evidence-loop-details.md).
The log is available via `/api/proxy/audit/export` for forensic copies.

The log:
- Includes redacted bodies (secrets stripped)
- Includes timing (request_started, response_complete, latency_ms)
- Includes session ID and PID where attribution is available
- Rotates by row count (not by file)

## Reporting issues

See [SECURITY.md — Reporting a Vulnerability](../SECURITY.md#reporting-a-vulnerability).
The TL;DR: GitHub private vulnerability reporting, do not open a public
issue.

## See also

- [SECURITY.md](../SECURITY.md) — public summary
- [docs/adr/001-production-deployment.md](adr/001-production-deployment.md) — header rationale
- [AGENTS.md §2](../AGENTS.md#2-supervision-boundaries) — supervisor trust boundaries
- [docs/evidence-loop-details.md](evidence-loop-details.md) — audit log format
- ADRs in [llms.txt](../llms.txt)
