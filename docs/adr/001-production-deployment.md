# ADR 001: Production deployment is a self-hosted single-process container, Chromium-only

> Status: Accepted (2026-04-26) — closes [#143](https://github.com/silentspike/noaide/issues/143)
> Related: ADR-8 (WebTransport-only transport), [#139](https://github.com/silentspike/noaide/issues/139), [#140](https://github.com/silentspike/noaide/issues/140), [#146](https://github.com/silentspike/noaide/issues/146)

## Context

The Hygiene-Sprint of 2026-04-24 left the following questions open
about production deployment:

1. Is the production target a standalone binary, a systemd unit, a
   container image, or something behind a reverse proxy?
2. How do production certificates work? Public CA? Self-signed?
3. What is the fallback for browsers without WebTransport (Firefox,
   Safari)? Do we add an SSE/WebSocket fallback, or do we declare
   the project Chromium-only?

Without an answer to these, the production CSP ([#139](https://github.com/silentspike/noaide/issues/139))
and production COOP/COEP ([#140](https://github.com/silentspike/noaide/issues/140))
cannot land — they need a server that actually serves the frontend
and emits headers.

## Decision

### Deployment target: single-process container

The production deployment is **the existing `noaide-server` binary
running inside the existing `Dockerfile`**, with the prebuilt frontend
bundle copied into `/app/static` and served by axum's
`tower_http::services::ServeDir` as a fallback handler.

There is no reverse proxy in front of the binary. There is no separate
frontend host. One process, two ports:

- `:8080` — HTTP/1.1 control plane (`/api/*`, static files, health)
- `:4433/udp` — HTTP/3 QUIC for WebTransport

A `docker-compose.prod.yml` packages the container with explicit
volume mounts for the agent home directories and a persistent DB
volume.

### Certificates: bring-your-own

We do not bundle a public-CA certificate. The deployer is expected
to mount their own `cert.pem` + `key.pem` at `/certs/` (a wildcard
LetsEncrypt cert via `certbot`, a corporate-CA-signed cert, or a
mkcert local CA). The server reads the paths from `NOAIDE_TLS_CERT`
and `NOAIDE_TLS_KEY` (already wired up).

Rationale: noaide is a self-hosted developer tool, not a SaaS. The
production deployer always has a domain and is competent to manage
certificates. We do not add automatic ACME client logic.

### Browser support: Chromium-only, documented

We do not add an SSE or WebSocket fallback. The transport remains
WebTransport-only (ADR-8 unchanged).

Rationale:
- WebTransport is supported in Chromium 97+ (Chrome, Edge, Brave,
  Arc, Opera) — the dominant developer-browser segment.
- Firefox WebTransport is gated behind `network.http.http3.enable`
  and incomplete; Safari has no WebTransport implementation.
- An SSE fallback would force a dual-codepath in the transport
  (FlatBuffers + Zstd over `text/event-stream` is messy), doubles
  the test matrix, and weakens ADR-8.

The README and AGENTS.md state the requirement explicitly. Users on
Firefox or Safari see the welcome screen but the WebTransport client
will fail to connect — a clear error message suffices.

## Consequences

### Positive

- One artefact to ship: the existing Docker image, plus a one-line
  `docker compose -f docker-compose.prod.yml up`.
- CSP and COOP/COEP land naturally (axum middleware with one branch:
  `if NOAIDE_STATIC_DIR is set`). Closes #139 and #140.
- No reverse-proxy operations burden, no ACME daemon to manage.
- Smoke test in CI is straightforward (docker compose up + curl
  headers + health check).

### Negative

- Browser support is limited. Each "WebTransport not supported" report
  is a Firefox/Safari user we cannot help without revisiting ADR-8.
- TLS configuration is a prerequisite for the deployer; first-run
  is not zero-config.

### Neutral

- The dev workflow is unchanged: Vite serves the frontend, the
  backend runs in dev mode without `NOAIDE_STATIC_DIR`, no
  production headers are emitted.
- The existing `docker-compose.yml` (dev) continues to work as a
  backend-only container; the new `docker-compose.prod.yml` adds the
  static-serving + headers path.

## How this is implemented

| Concern | Implementation |
|---------|----------------|
| Static file serving | `ServeDir` as `fallback_service` when `NOAIDE_STATIC_DIR` is set |
| CSP | `tower_http::set_header::SetResponseHeaderLayer` with strict policy (closes #139) |
| COOP / COEP / CORP | Same layer, set in production mode only (closes #140) |
| Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy | Same layer for defence-in-depth |
| TLS for HTTP/3 | Existing `wtransport` setup, `NOAIDE_TLS_CERT` + `NOAIDE_TLS_KEY` |
| TLS for HTTP/1.1 | None at the binary; the deployer can put a TLS-terminating proxy in front if needed (out of scope here) |
| Smoke test | CI workflow runs `docker compose -f docker-compose.prod.yml up`, curls `/health`, checks for `Content-Security-Policy` and `Cross-Origin-Embedder-Policy` headers |

The code paths are gated by `NOAIDE_STATIC_DIR`. When unset (dev),
the server runs exactly as before. When set (production), it serves
the frontend and emits the hardened headers.

## Alternatives considered

### Reverse proxy (nginx + h3) in front of the binary

Rejected. Adds an operations layer (nginx config, reload semantics,
HTTP/3 module compilation flags) for no transport benefit — the
backend already speaks WebTransport directly. The CSP / COOP / COEP
would land in nginx config files instead of code, which makes them
harder to test in CI.

### SSE fallback transport for Firefox / Safari

Rejected. ADR-8 explicitly chose WebTransport-only after considering
SSE. The dual codepath, doubled test matrix, and the loss of multiplexing
+ 0-RTT all argue against re-introducing SSE. The market data
(developer browsers are ~80% Chromium) makes Chromium-only acceptable
for an alpha.

### Standalone binary with a systemd unit

Rejected as the *primary* path, accepted as a *secondary* example.
The container is the canonical artefact because it composes with
mounted volumes and a healthcheck. A systemd unit example will land
in `docs/deployment-guide.md` (closes part of [#146](https://github.com/silentspike/noaide/issues/146))
for users who do not use Docker.

## Verification

The CI smoke test exercises the full production path:

1. Build the Docker image
2. `docker compose -f docker-compose.prod.yml up -d`
3. `curl -sf http://localhost:8080/health` returns 200
4. `curl -sI http://localhost:8080/` includes:
   - `Content-Security-Policy: default-src 'self'; script-src 'self'; ...`
   - `Cross-Origin-Opener-Policy: same-origin`
   - `Cross-Origin-Embedder-Policy: require-corp`
   - `Cross-Origin-Resource-Policy: same-origin`
5. `curl -s http://localhost:8080/` returns the prebuilt
   `index.html` with `<title>noaide</title>`.

If any of those four fail, the workflow fails — the gate that closes
[#139](https://github.com/silentspike/noaide/issues/139),
[#140](https://github.com/silentspike/noaide/issues/140), and
[#143](https://github.com/silentspike/noaide/issues/143).

## References

- [#143 — original issue](https://github.com/silentspike/noaide/issues/143)
- [ADR-8 — WebTransport-only transport](../../llms.txt)
- [SECURITY.md](../../SECURITY.md)
- [AGENTS.md](../../AGENTS.md)
- [docs/deployment-guide.md](../deployment-guide.md) — operator-facing instructions (lands with #146)
