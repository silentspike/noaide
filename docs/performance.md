# Performance — Design Goals and Measured Numbers

This document collects the performance details that previously sat in
the README hero. The hero is for the operator-console story; this is
for the architect or systems engineer who wants to know what the
architecture is designed around and what is actually measured.

> **Status.** noaide is pre-alpha. The criterion suite under
> `server/benches/` covers two hot paths and runs nightly. Everything
> else listed below is a **design goal** — a number the architecture
> targets, not a measurement.

---

## Design goals

```
File event to browser       ████████████████████████████░░  < 50 ms p99
Message fetch (cached)      ██████████████████████████████  < 5 ms
Rendering (1000+ msgs)      ██████████████████████████████  120 Hz
Server RSS (10 sessions)    █████████████░░░░░░░░░░░░░░░░░  < 200 MB
Browser memory              ████████████████░░░░░░░░░░░░░░  < 500 MB
JSONL parse rate            ██████████████████████████████  > 10k lines/s
Zenoh SHM latency           ██████████████████████████████  ~1 µs
API proxy overhead          ██████████████████████████████  < 5 ms
Zstd bandwidth reduction    █████████████████████░░░░░░░░░  ~70%
```

End-to-end latency benchmarks (Playwright traces for the file event →
browser path, FPS at 1000+ messages) are still on the roadmap. Treat
any bar without a matching bench as a design goal, not a measurement.

## Latest measurements (criterion, 2026-04-26)

Run on the build server (release profile):

```
parse_line/user_message       2.19 µs/line   →   456k lines/sec     (goal: > 10k)
parse_line/tool_use_message   4.01 µs/line   →   249k lines/sec
component_to_api_json (text)    955 ns/msg
pagination_window/200 msgs    240   µs       =     0.24 ms          (goal: < 5 ms)
```

Both bench-covered hot paths beat their design goals by 20–45×.

Fetch the most recent run from the **`benchmark-results-*`** artefact
of the latest [Nightly workflow run](https://github.com/silentspike/noaide/actions/workflows/nightly.yml).

To reproduce locally:

```bash
cargo bench --workspace
ls target/criterion/{parse_line,component_to_api_json,pagination_window}
```

## 120 Hz rendering

The frontend targets 120 Hz on a desktop with 1000+ messages in the
chat panel. The architecture choices that buy that headroom:

- **SolidJS, no Virtual DOM.** Fine-grained reactivity updates the
  exact DOM nodes that depend on a changed signal — no diff phase per
  frame.
- **Virtual scroller, ~25 DOM nodes max.** A pool of recycled message
  components covers the visible window plus a small overdraw on each
  side. Off-screen messages exist as data, not DOM.
- **WASM workers off the main thread.** JSONL parsing
  (`wasm/jsonl-parser`), Markdown rendering (`wasm/markdown`), and
  Zstd decompression (`wasm/compress`) run inside Web Workers,
  feeding parsed messages back to the main thread. Cross-Origin
  Isolation (COOP/COEP) is required for `SharedArrayBuffer`.
- **Spring-physics animations.** Animations driven by an explicit
  spring model rather than CSS keyframes — terminates cleanly on
  destination, never overshoots, never queues frames behind a long
  tail.

## Wire format and transport

- **Hot path: FlatBuffers + Zstd.** Zero-copy decode in the browser
  for `message.new`, `file.change`, and `pty.output` events. Targets
  ~200 events/sec sustained.
- **Cold path: MessagePack + Zstd.** Used for less frequent control
  messages where flexibility matters more than raw speed (~2
  events/sec, e.g. session-list updates, plan changes).
- **Compression.** Zstd dictionary-trained on real JSONL samples;
  measured ~70% bandwidth reduction on real Claude / Codex / Gemini
  rollouts.

## WebTransport (HTTP/3 QUIC)

noaide is WebTransport-only on the wire. ADR-008 explains the
trade-off: no SSE/WebSocket fallback in the alpha; non-Chromium
browsers fail to connect. ADR-001 documents the production
deployment story.

What WebTransport buys here:

- **0-RTT reconnect.** A returning client resumes its session keys
  without a fresh handshake — the chat keeps streaming during
  WiFi-to-cellular handover.
- **Multiplexed streams.** Hot path (FlatBuffers events), cold path
  (MessagePack control), and PTY echo each get their own stream and
  do not head-of-line block one another.
- **Connection migration.** QUIC's connection ID survives a network
  switch; the browser stays attached when the laptop's path changes.

The transport layer (`server/src/transport/webtransport.rs`) speaks
QUIC via `quinn`, terminates TLS 1.3 with mkcert / LetsEncrypt /
corporate-CA certificates, and exposes the streams to the SolidJS
client (`frontend/src/transport/client.ts`).

## Adaptive quality

The transport layer measures round-trip time on each frame and steps
between three render tiers:

| RTT | Tier | Effect |
|---|---|---|
| < 50 ms | 120 Hz | Full reactivity, full animation budget |
| 50–150 ms | 30 Hz | Cap render frequency, keep animations |
| > 150 ms | 10 Hz | Drop animation budget, keep functional updates |

The tier is published as a signal and the chat panel and other
high-frequency surfaces subscribe to it, so the budget is enforced
at the consumer rather than centrally.

## Backpressure

Bounded channels with explicit drop policies. The two channel
families relevant to the hot path:

- **`file.change`.** Bounded at 500. When full, drop the **oldest**
  pending event — the latest filesystem state matters, not the
  intermediate journey.
- **`message.new`.** Bounded at 5000. **Never drop.** A dropped chat
  message is a UX disaster; we'd rather slow the producer.

Smaller channels (`pty.output`, `proxy.request`) are sized to their
expected throughput and use the appropriate drop policy.

## Where the rest of the system stays out of the way

- **Limbo cache hit path.** ~5 ms cached responses are paid for by
  pre-loading the ECS world from JSONL on startup; the DB is a cache,
  not the source of truth. Re-deriving state is a regenerable cost.
- **Zenoh + SHM event bus.** Inter-component messaging at ~1 µs,
  zero-copy IPC where the browser does not see it.
- **eBPF watcher PID attribution.** No userspace-level inotify ladder
  to climb — the kernel hands us the writing PID per fanotify event.

## See also

- [`README.md` — Tech Stack](../README.md#tech-stack) — the layer
  table that picks each component
- [`docs/architecture.md`](architecture.md) — full component map and
  data flows
- [`llms.txt`](../llms.txt) — the 11 ADRs that drove these choices,
  with rejected alternatives
- [`docs/adr/001-production-deployment.md`](adr/001-production-deployment.md)
  — production-mode deployment story (Chromium-only, BYO-TLS)
