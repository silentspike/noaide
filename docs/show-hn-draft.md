# Show HN Draft

> Draft submission for [Hacker News](https://news.ycombinator.com/submit).
> Tracks [issue #151](https://github.com/silentspike/noaide/issues/151).
> **Not yet submitted** — review the accuracy notes at the bottom
> before posting.

---

## Title (Hacker News submission)

```
Show HN: noaide – Watch your AI coding agent in real time
```

## URL

```
https://github.com/silentspike/noaide
```

## First comment (the one HN expects from the OP)

> noaide is a self-hosted, browser-based IDE for watching AI coding
> agents (Claude Code, Gemini CLI, Codex) live as they work. The agent
> stays in your terminal where you started it; noaide attaches and
> renders every JSONL log line — including the parts the agent's
> own UI suppresses (system-reminders, hidden instructions, thinking
> blocks, tool-use envelopes).
>
> What it gives you:
>
> - **Full transparency** — 100% of the JSONL is rendered, including
>   the ~40% the terminal UIs hide
> - **PID-attributed file watching** — eBPF (with inotify fallback)
>   tells you who wrote each change: you or the agent
> - **API proxy with manual gate** — every LLM request is captured;
>   you can hold, edit, drop, or forward each one. Secrets are
>   redacted in flight
> - **Conflict detection** — if you and the agent edit the same file,
>   you get a yellow banner, an OT buffer, and a 3-way merge after
>   the agent finishes
> - **Multi-agent topology view** — sub-agent hierarchies as a
>   force-directed graph + swimlane timeline + Gantt
>
> Stack: Rust + tokio + io_uring on the backend, SolidJS + Vite +
> WASM workers on the frontend, WebTransport (HTTP/3) between them,
> [hecs](https://docs.rs/hecs) ECS for the in-memory state, [Limbo](https://github.com/tursodatabase/limbo)
> for the SQLite cache, [Zenoh](https://zenoh.io) shared memory for
> the internal event bus. The 11 architecture decisions are in
> [llms.txt](https://github.com/silentspike/noaide/blob/main/llms.txt).
>
> This is a pre-alpha. The end-to-end loop works against seeded
> fixtures and live agent sessions. Production is documented in
> [ADR-001](https://github.com/silentspike/noaide/blob/main/docs/adr/001-production-deployment.md):
> a single-process container with bring-your-own TLS, Chromium-only
> (no SSE/WebSocket fallback). Hardened headers — strict CSP,
> COOP/COEP/CORP, HSTS — are emitted by the production server and
> asserted on every push by `prod-smoke.yml`. Criterion benches
> cover the two hot paths (`parse_line`, `component_to_api_json`)
> and run nightly; their measurements are uploaded as a CI artefact
> the README links to.
>
> What is *not* done yet, honestly: end-to-end latency benchmarks
> (Playwright traces for file event → browser p99, FPS at 1000+
> messages), a fallback transport for non-Chromium browsers, and a
> formal multi-tenant story. Those are roadmap, not blockers for
> the alpha.
>
> Quick start:
>
> ```
> just certs            # generate local TLS certs (mkcert)
> just dev              # docker compose up (backend)
> just dev-front        # frontend dev server (HMR)
> ```
>
> Or for a production-style deployment:
>
> ```
> docker compose -f docker-compose.prod.yml up -d
> ```
>
> Happy to answer questions about the eBPF watcher, the WebTransport
> stack, or why I picked SolidJS over the obvious alternatives.

---

## Image to include

Use `docs/images/session-active-chat.png` as the lead screenshot —
it shows the three-panel layout with a real Claude session active,
chat messages rendered, file explorer populated. The welcome screen
(`docs/images/welcome-screen.png`) is also good as a "first impression"
shot but tells less.

---

## Accuracy review (run before posting)

Each claim in the draft is checked against the current repo state:

| Claim | Evidence command | OK? |
|-------|------------------|-----|
| "100% of the JSONL rendered" | `rg "system-reminder\|thinking\|tool_use" frontend/src/components/chat/` | ✅ |
| "eBPF + inotify fallback" | `cat server/src/watcher/mod.rs` shows both paths | ✅ |
| "API proxy with manual gate" | `rg "intercept_mode" server/src/proxy/` | ✅ |
| "secrets redacted in flight" | `rg "sk-ant-\|Bearer " server/src/proxy/handler.rs` | ✅ |
| "OT buffer + 3-way merge" | `frontend/src/lib/ot-buffer.ts` + `MergeView` in editor | ✅ |
| "Rust + tokio + io_uring" | `Cargo.toml` lists `tokio` + io_uring features | ✅ |
| "SolidJS + Vite + WASM workers" | `frontend/package.json` lists `solid-js`, `vite`; `frontend/src/wasm/` exists | ✅ |
| "WebTransport (HTTP/3)" | `server/src/transport/webtransport.rs` | ✅ |
| "hecs ECS" | `Cargo.toml` lists `hecs`; `server/src/ecs/` exists | ✅ |
| "Limbo SQLite cache" | `Cargo.toml` lists `limbo` (not `rusqlite`) | ✅ |
| "Zenoh + SHM event bus" | `Cargo.toml` lists `zenoh` + `zenoh-shm` | ✅ |
| "11 ADRs in llms.txt" | `llms.txt` exists in repo root | ✅ |
| "Chromium-only, ADR-001" | `docs/adr/001-production-deployment.md` exists | ✅ |
| "performance numbers as design goals" | `README.md` "## Performance — Design Goals" section | ✅ |
| "Hardened headers + benches landed" | #139, #140, #142 are CLOSED with `status:verified` + AC Audit | ✅ |
| "ADR-001 documents the deployment" | `docs/adr/001-production-deployment.md` exists | ✅ |
| "Roadmap items honestly listed" | end-to-end latency benches, non-Chromium fallback, multi-tenant story all explicitly *not* done | ✅ |
| "just certs / just dev / just dev-front" | `justfile` has these recipes | ✅ |
| "docker-compose.prod.yml" | file exists | ✅ |

If any column flips to ❌ between draft time and post time, fix the
draft before posting.

---

## Post-submission tracking

After submitting:

1. Add the HN URL to this file under "Submission".
2. Watch the front page and the comments for ~6 hours.
3. Triage actionable feedback into new issues. Tag with `source:hn`.

## Submission

> Not yet submitted. After posting, replace this paragraph with the
> HN URL and timestamp. Mark issue #151 closed once the post is live
> and the first wave of comments has been triaged into issues
> (acceptance criterion AC-3 + AC-4).

---

## Notes for the human posting this

- HN prefers Tuesday–Thursday, 8am–10am US Pacific. Avoid weekends.
- Don't add the URL to the body of the post — the URL field is
  separate. The body becomes the first comment.
- Stay in the thread for the first hour to answer technical questions.
- If the post does not gain traction within 30 min, do not re-submit
  on the same day. HN penalises duplicate submissions.
- Do not solicit upvotes on social media. HN flags this aggressively.
