# TLS Certificates

Local TLS certificates for WebTransport (HTTP/3 QUIC) development.

## Privacy Note

All `.pem` files in this directory are **gitignored**. Each developer
generates their own local certificates. Certificates are never committed.

`mkcert` embeds the generator's `OU=<user>@<hostname>` into the certificate
subject. Since the `.pem` files stay local, this has no public exposure —
but be aware if you share your Vite dev server, browser DevTools, or
curl output with others, the certificate subject will contain your
username and machine hostname.

If you prefer a neutral subject, generate certificates on a machine with a
neutral user/hostname (e.g. inside a container), or use raw `openssl` /
`cfssl` to produce a custom `O=noaide development certificate` subject
without user/host identifiers.

## Generate

```bash
# Install mkcert (first time only)
mkcert -install

# Generate certificates
mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
  noaide.local localhost 127.0.0.1 ::1
```

## Files

| File | Purpose | Gitignored |
|------|---------|------------|
| `cert.pem` | TLS certificate | Yes |
| `key.pem` | TLS private key | Yes |
| `rootCA.pem` | Local CA copy (from `mkcert -CAROOT`) | Yes |

## Why mkcert?

WebTransport requires valid TLS certificates. `mkcert` creates a local CA
trusted by the system and browser, avoiding certificate warnings during
development. The CA is stored in the system trust store (not in this
directory).

## Verification

After generation, verify the certificate has no stale hostnames:

```bash
openssl x509 -in certs/cert.pem -noout -subject
openssl x509 -in certs/cert.pem -noout -ext subjectAltName
```
