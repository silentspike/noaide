# TLS Certificates

Local TLS certificates for WebTransport (HTTP/3 QUIC) development.

## Privacy Note

All `.pem` files in this directory are **gitignored**. Each developer
generates their own local certificates. Certificates are never committed.

`mkcert` embeds the generator's `OU=<user>@<hostname>` into both the
certificate's **subject** and **issuer**. The `.pem` files stay local, so
this has no public-tree exposure — but be aware:

- If you share Vite dev-server output, browser DevTools transcripts, or
  any tool that prints certificate details, the subject and issuer will
  contain your username and machine hostname.
- **Never paste the contents of `cert.pem`, `fullchain.pem`, the
  `openssl x509 -text` output, or screenshots of TLS dialogs into
  public bug reports, screenshots, or live demos.** Treat them like
  any other operator-identifying artefact.

### Subject sanitization is tool-specific

`mkcert` always writes a personalised OU because that is its CA's
identity. There is no `mkcert` flag to override it.

If you need a neutral subject (e.g. recording a demo, publishing
screenshots, sharing a live session), produce the leaf cert with raw
OpenSSL and sign it with the existing mkcert CA:

```bash
CAROOT=$(mkcert -CAROOT)

openssl genrsa -out certs/key.pem 2048
openssl req -new -key certs/key.pem \
  -subj "/CN=noaide development certificate/O=noaide" \
  -out /tmp/csr.pem

cat > /tmp/v3.ext <<'EOF'
subjectAltName = DNS:noaide.local, DNS:localhost, IP:127.0.0.1, IP:::1
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
EOF

openssl x509 -req -in /tmp/csr.pem \
  -CA "$CAROOT/rootCA.pem" -CAkey "$CAROOT/rootCA-key.pem" -CAcreateserial \
  -days 825 -sha256 -extfile /tmp/v3.ext \
  -out certs/cert.pem

openssl x509 -in certs/cert.pem -noout -subject
# subject=CN=noaide development certificate, O=noaide
```

The leaf is now neutral. The **issuer** still carries the mkcert CA's
personalised OU because that CA was generated with `mkcert -install`;
re-issue from a fresh CAROOT (or a corporate dev CA) if the issuer line
also needs to be neutral.

## Generate (mkcert default)

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
