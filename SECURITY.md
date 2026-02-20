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

- All dependencies regularly updated via Dependabot
- CodeQL SAST scanning on every push/PR
- `cargo audit` and `npm audit` in CI pipeline
- Secret scanning enabled
- TLS 1.3 enforced for all transport (QUIC/WebTransport)
- API key redaction (`sk-ant-*`, `Bearer *`) via regex in logs and UI
- CSP strict policy, SolidJS auto-escapes output
- PTY input sanitized, no `shell=true`
- API proxy whitelists only `api.anthropic.com`
- CORS strict same-origin
- COOP/COEP for cross-origin isolation (SharedArrayBuffer)
- eBPF programs pre-verified, no dynamic loading
