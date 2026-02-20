#!/usr/bin/env bash
# noaide — Self-hosted Runner Setup Script
# Target: Debian 12 (or compatible), 4+ cores, 8GB+ RAM recommended
# Usage: ssh root@<runner-host> "bash -s" < scripts/setup-runner.sh

set -euo pipefail

echo "=== noaide Runner Setup ==="
echo "Installing all CI/CD dependencies..."

# System packages
apt-get update
apt-get install -y \
  build-essential pkg-config gcc g++ \
  libssl-dev libelf-dev llvm-dev clang \
  git curl wget unzip \
  jq python3 python3-pip \
  linux-headers-$(uname -r) || true

# Rust (stable + nightly)
if ! command -v rustup &>/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
source "$HOME/.cargo/env"
rustup toolchain install stable nightly
rustup default stable
rustup component add clippy rustfmt

# Node.js 22
if ! command -v node &>/dev/null || [[ "$(node --version)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# wasm-pack
if ! command -v wasm-pack &>/dev/null; then
  curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

# FlatBuffers compiler (flatc)
if ! command -v flatc &>/dev/null; then
  FLATC_VERSION="24.3.25"
  wget -q "https://github.com/google/flatbuffers/releases/download/v${FLATC_VERSION}/Linux.flatc.binary.clang++-17.zip" -O /tmp/flatc.zip
  unzip -o /tmp/flatc.zip -d /usr/local/bin/
  chmod +x /usr/local/bin/flatc
  rm /tmp/flatc.zip
fi

# mkcert (local TLS)
if ! command -v mkcert &>/dev/null; then
  MKCERT_VERSION="v1.4.4"
  wget -q "https://dl.filippo.io/mkcert/latest?for=linux/amd64" -O /usr/local/bin/mkcert
  chmod +x /usr/local/bin/mkcert
fi

# cargo-audit (pre-installed binary, not compiled every CI run)
cargo install cargo-audit

# gitleaks
if ! command -v gitleaks &>/dev/null; then
  GITLEAKS_VERSION="8.18.4"
  wget -q "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -O /tmp/gitleaks.tar.gz
  tar xzf /tmp/gitleaks.tar.gz -C /usr/local/bin/ gitleaks
  rm /tmp/gitleaks.tar.gz
fi

# Docker (for Playwright E2E)
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# bpf-linker (for eBPF/aya)
cargo install bpf-linker || echo "WARNING: bpf-linker install failed (may need LLVM 17+)"

# Verify all tools
echo ""
echo "=== Verification ==="
echo "Rust:      $(rustc --version)"
echo "Cargo:     $(cargo --version)"
echo "Node:      $(node --version)"
echo "npm:       $(npm --version)"
echo "wasm-pack: $(wasm-pack --version)"
echo "flatc:     $(flatc --version)"
echo "mkcert:    $(mkcert --version 2>&1 || echo 'installed')"
echo "gitleaks:  $(gitleaks version)"
echo "docker:    $(docker --version)"
echo "cargo-audit: $(cargo audit --version)"
echo ""
echo "=== Setup Complete ==="
