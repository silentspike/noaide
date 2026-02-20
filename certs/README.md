# TLS Certificates

Local TLS certificates for WebTransport (HTTP/3 QUIC) development.

## Generate

```bash
# Install mkcert (first time only)
mkcert -install

# Generate certificates
mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1 ::1
```

## Files

| File | Purpose | Gitignored |
|------|---------|------------|
| `cert.pem` | TLS certificate | Yes |
| `key.pem` | TLS private key | Yes |

Certificate files are gitignored. Each developer must generate their own.

## Why mkcert?

WebTransport requires valid TLS certificates. `mkcert` creates a local CA
trusted by the system and browser, avoiding certificate warnings during
development. The CA is stored in the system trust store (not in this directory).
