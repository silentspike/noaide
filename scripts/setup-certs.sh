#!/usr/bin/env bash
# setup-certs.sh — generate local TLS certificates for noaide development.
#
# noaide uses WebTransport, which requires valid TLS. This script
# wraps `mkcert` to produce cert.pem + key.pem in ./certs/.
#
# Usage:
#   bash scripts/setup-certs.sh
#   just certs
#   make certs
#
# This script is idempotent: re-running overwrites the existing pair.

set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "error: mkcert is not installed." >&2
  echo "Install it first:" >&2
  echo "  macOS:  brew install mkcert" >&2
  echo "  Debian: apt install mkcert  (Debian 12+ / Ubuntu 22.04+)" >&2
  echo "  any:    https://github.com/FiloSottile/mkcert#installation" >&2
  exit 1
fi

mkdir -p "$CERT_DIR"

# Install the mkcert CA into the system trust store on first run.
# If it is already installed, this is a cheap no-op.
mkcert -install

mkcert -cert-file "$CERT_FILE" -key-file "$KEY_FILE" \
  noaide.local localhost 127.0.0.1 ::1

echo
echo "Certificates written:"
echo "  $CERT_FILE"
echo "  $KEY_FILE"
echo
echo "Subject:"
openssl x509 -in "$CERT_FILE" -noout -subject

echo
echo "Validity:"
openssl x509 -in "$CERT_FILE" -noout -dates
