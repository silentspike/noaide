# scripts/

Only one script in this directory is part of the public workflow. The rest are
developer-local helpers that stay out of the tracked tree.

## Tracked (public)

- [`setup-runner.sh`](setup-runner.sh) — bootstraps a self-hosted GitHub Actions
  runner. Referenced by documentation; safe to share.

## Gitignored (local dev helpers)

These scripts are useful during development but ship secrets, host-specific
paths, or invasive tooling that has no place in a public repository. They live
in the worktree for convenience and are excluded via `.gitignore`.

| Script | Purpose |
| --- | --- |
| `check-pki-health.sh` | Probes the mkcert CA, root trust, and local cert expiry |
| `net-trace.sh` | Captures decrypted HTTP/2 traffic (requires elevated privileges) |
| `renew-certs.sh` | Regenerates the local mkcert development certificates |
| `start-gui.sh` | Launches the frontend, backend, and browser in one shot |

If you need the equivalent functionality in CI or a fresh clone, prefer the
`justfile` / `docker-compose.yml` entry points over invoking these scripts
directly.
