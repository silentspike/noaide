# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |
| < latest | No       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **DO NOT** create a public GitHub issue
2. Use GitHub's private vulnerability reporting:
   Settings > Security > Advisories > Report a vulnerability

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Assessment:** Within 7 days
- **Fix:** Depends on severity
  - Critical: 72 hours
  - High: 2 weeks
  - Medium: 1 month
  - Low: Next release

## Security Measures

The project is in pre-alpha. This section only lists controls that are
actually implemented in the current codebase. Items on the roadmap but
not yet in place are listed separately below.

### In Place

- GitHub Actions dependencies updated via Dependabot
- CodeQL SAST scanning on every push/PR
- `cargo audit` in the nightly CI workflow
- `pnpm audit --audit-level=high` in the nightly CI workflow (fails on high+)
- Secret scanning enabled on the repository
- TLS 1.3 via QUIC/WebTransport for the dev server (self-signed local CA)
- API key redaction (`sk-ant-*`, `Bearer *`) via regex in logs and UI
- PTY input handling does not spawn shells with `shell=true`
- API proxy forwards only to `api.anthropic.com`, `cloudcode-pa.googleapis.com`, `chatgpt.com`
- CORS same-origin enforcement in the dev server
- COOP/COEP headers set by the Vite dev server for cross-origin isolation
  (required for SharedArrayBuffer in WASM workers); production headers
  depend on the eventual deployment target
- SolidJS auto-escapes interpolated output in templates

### Roadmap (not yet in place)

- [ ] Strict Content-Security-Policy on a production server
      (tracked in issue: "Enforce strict CSP on production server")
- [ ] COOP/COEP as production HTTP response headers (currently only set
      by the Vite dev server — tracked in issue: "Enable COOP/COEP in
      production HTTP response headers")
- [ ] Pre-verified eBPF programs with dynamic-loading disabled in
      documentation (eBPF is already load-time-verified by the kernel;
      a formal hardening note is pending)
