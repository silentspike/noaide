# Deployment Guide

This document is the operator-facing companion to
[ADR 001: Production deployment](adr/001-production-deployment.md). The
ADR explains *why* the production target is a single-process container
with bring-your-own TLS and Chromium-only browser support. This guide
explains *how* to actually deploy it.

> **Status**: production target was decided in ADR-001 on 2026-04-26.
> The smoke test in CI exercises this exact path on every push to main.

## Prerequisites

- Linux host with Docker (or Podman with `docker-compose` shim)
- Domain name pointing at the host (or `localhost` for a private setup)
- A TLS key pair (`cert.pem`, `key.pem`)
- Agent home directory(ies) on the host containing JSONL session files

## Path A — Docker Compose (recommended)

The canonical artefact is [`docker-compose.prod.yml`](../docker-compose.prod.yml)
in the repo root.

### 1. Get a TLS certificate

Three viable sources, in order of preference:

| Source | When | How |
|--------|------|-----|
| LetsEncrypt | Public-internet host with DNS | `certbot certonly --standalone -d noaide.example.com` |
| Corporate CA | Internal/intranet host | Issue from your PKI, no special config needed |
| `mkcert` | Localhost only, dev-style | `mkcert -cert-file certs/cert.pem -key-file certs/key.pem noaide.local localhost 127.0.0.1` |

Place the cert pair under `./certs/cert.pem` and `./certs/key.pem`.

### 2. Configure the deployment

```bash
cp .env.example .env  # if it exists; otherwise create one
echo "NOAIDE_JWT_SECRET=$(openssl rand -hex 32)" >> .env
# Optional: point at a non-default agent home
echo "AGENT_HOME=/var/lib/noaide-agent-home" >> .env
```

### 3. Bring it up

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f
```

The healthcheck takes up to 30 s on first start (eBPF attach +
discovery scanner indexes the agent home).

### 4. Verify

```bash
# HTTP API + static frontend on :8080
curl -sf http://localhost:8080/health                            # → 200 OK

# Hardened response headers (closes #139, #140)
curl -sI http://localhost:8080/ | grep -iE "content-security-policy|cross-origin"
# Expected:
#   Content-Security-Policy: default-src 'self'; script-src 'self'; ...
#   Cross-Origin-Opener-Policy: same-origin
#   Cross-Origin-Embedder-Policy: require-corp
#   Cross-Origin-Resource-Policy: same-origin

# Frontend bundle is served
curl -s http://localhost:8080/ | grep -i "<title>"               # → <title>noaide</title>
```

If the curl commands above all return what they should, your
deployment matches the CI smoke test.

### 5. Open the UI

Point a Chromium-based browser (Chrome, Edge, Brave, Arc, Opera) at
`https://noaide.example.com:4433/noaide/` (or whatever your hostname
is). WebTransport requires HTTP/3 with a valid TLS chain, which is
why the cert step matters.

## Path B — Standalone systemd unit

If you do not run Docker, the same binary works as a plain process.

### Build or download

```bash
# Build from source
just build
sudo cp target/release/noaide-server /usr/local/bin/

# OR: download the prebuilt binary from a release tag
curl -L https://github.com/silentspike/noaide/releases/download/v0.1.0-alpha.1/noaide-server -o /usr/local/bin/noaide-server
sudo chmod +x /usr/local/bin/noaide-server
```

### systemd unit

```ini
# /etc/systemd/system/noaide.service
[Unit]
Description=noaide AI coding agent IDE
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=noaide
Group=noaide
ExecStart=/usr/local/bin/noaide-server
Restart=on-failure
RestartSec=5

# Production mode: serve frontend + emit hardened headers
Environment=NOAIDE_STATIC_DIR=/var/lib/noaide/static
Environment=NOAIDE_HTTP_PORT=8080
Environment=NOAIDE_PORT=4433
Environment=NOAIDE_DB_PATH=/var/lib/noaide/data/ide.db
Environment=NOAIDE_TLS_CERT=/etc/noaide/certs/cert.pem
Environment=NOAIDE_TLS_KEY=/etc/noaide/certs/key.pem
Environment=NOAIDE_WATCH_PATHS=/home/noaide/.claude
# Public hostname users hit in the browser. The CSP allows the
# WebTransport endpoint at `https://${NOAIDE_PUBLIC_WT_HOST}:${NOAIDE_PORT}`,
# so this must match the host the browser sees. Defaults to localhost.
Environment=NOAIDE_PUBLIC_WT_HOST=noaide.example.com
EnvironmentFile=/etc/noaide/noaide.env

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/noaide
PrivateTmp=true
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
```

```bash
# Place the prebuilt frontend bundle and start
sudo mkdir -p /var/lib/noaide/{data,static} /etc/noaide/certs
sudo cp -r frontend/dist/* /var/lib/noaide/static/
sudo cp ./certs/{cert.pem,key.pem} /etc/noaide/certs/
echo "NOAIDE_JWT_SECRET=$(openssl rand -hex 32)" | sudo tee /etc/noaide/noaide.env

sudo systemctl daemon-reload
sudo systemctl enable --now noaide
sudo systemctl status noaide
```

The systemd path is otherwise equivalent to the container path.

## Browser compatibility

ADR-001 documents that noaide is **Chromium-only**. WebTransport
support in Firefox is gated behind a flag and incomplete; Safari has
no WebTransport implementation. There is no SSE/WebSocket fallback
(this is ADR-008).

| Browser | Verdict |
|---------|---------|
| Chrome 97+ | ✅ |
| Edge 97+ | ✅ |
| Brave / Arc / Opera | ✅ (Chromium-based) |
| Firefox | ❌ — connection fails, error in WelcomeScreen |
| Safari | ❌ — no WebTransport implementation |

If you have a population that includes non-Chromium browsers and you
want to address it, the path is to revisit ADR-008 and add an SSE
fallback. That work is intentionally not in scope for the alpha.

## Operational notes

### TLS rotation

The server reads `NOAIDE_TLS_CERT` and `NOAIDE_TLS_KEY` at startup.
After a `certbot renew`, restart the container or unit:

```bash
docker compose -f docker-compose.prod.yml restart noaide
# OR
sudo systemctl reload noaide   # only if you add ExecReload — current unit lacks it
sudo systemctl restart noaide
```

### Backups

The Limbo database under `/data/noaide/` (Docker volume `noaide-data`)
or `/var/lib/noaide/data/` (systemd) is a regeneratable cache. Losing
it is non-fatal: on restart, the parser rebuilds the database from the
JSONL files in the agent home directory. Back up only if you want to
preserve the proxy audit log (which is *not* in JSONL).

### Logs

Backend logs go to stdout in JSON format (when
`NOAIDE_LOG_LEVEL=info` or higher). Use `docker compose logs` or
`journalctl -u noaide` to read them. Each log line carries a
session-ID span, so filtering by session is straightforward:

```bash
journalctl -u noaide -o cat | jq -c 'select(.fields.session_id == "<uuid>")'
```

### Secret hygiene

`NOAIDE_JWT_SECRET` is the one piece of state you must protect. Lose
it, and existing JWT tokens are invalidated; leak it, and an attacker
could forge tokens. Generate it once with `openssl rand -hex 32` and
keep it in your secret manager.

The proxy audit log (in `noaide-data` volume) contains redacted
request/response bodies. Treat the volume as sensitive.

## See also

- [docs/adr/001-production-deployment.md](adr/001-production-deployment.md) — the design decision
- [SECURITY.md](../SECURITY.md) — full security model
- [docs/architecture.md](architecture.md) — what the components are
- [docs/api.md](api.md) — HTTP endpoints
- [README.md — Quick Start](../README.md#quick-start) — dev workflow
