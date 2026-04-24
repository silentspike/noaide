# justfile — developer workflow helpers for noaide
#
# Install `just` with your package manager:
#   brew install just         (macOS)
#   cargo install just        (any)
#   apt install just          (Debian sid / Ubuntu 24.04+)
#
# Run `just` to see the default task, `just -l` to list all.
# The Makefile in this repo mirrors these targets for users without just.

# Default task: list available recipes.
default:
    @just -l

# ── Local dev servers ─────────────────────────────────────────────
# Bring up the whole thing in Docker (backend only; start `just dev-front` for HMR frontend).
dev:
    docker compose up

# Stop docker compose and remove containers.
dev-stop:
    docker compose down

# Frontend dev server with HMR (proxies /api to :8080). Run alongside `just dev`.
dev-front:
    cd frontend && pnpm dev

# Native backend + native frontend, no docker. Two separate terminals.
dev-backend-native:
    cargo run --bin noaide-server

dev-front-native:
    cd frontend && pnpm dev

# ── Tests and linting ────────────────────────────────────────────
# Run all tests: Rust unit + integration, frontend, end-to-end smoke.
test: test-rust test-front

test-rust:
    cargo test --workspace

test-front:
    cd frontend && pnpm test

# Playwright end-to-end smoke suite.
test-e2e:
    cd frontend && pnpm run e2e

# Formatters.
fmt:
    cargo fmt --all
    cd frontend && pnpm run format || true

fmt-check:
    cargo fmt --all -- --check
    cd frontend && pnpm run format:check || true

# Linters — Rust clippy + frontend ESLint.
lint:
    cargo clippy --workspace --all-targets -- -D warnings
    cd frontend && pnpm lint

# Dependency audit.
audit:
    cargo audit
    cd frontend && pnpm audit --audit-level=high

# Benchmarks (design goals — see docs/architecture.md).
bench:
    cargo bench --workspace

# ── Build artefacts ──────────────────────────────────────────────
# Release build of the server binary.
build:
    cargo build --release --bin noaide-server

# Compile all three WASM modules for the browser.
wasm:
    wasm-pack build wasm/jsonl-parser --target web --out-dir ../../frontend/src/wasm/jsonl-parser
    wasm-pack build wasm/markdown     --target web --out-dir ../../frontend/src/wasm/markdown
    wasm-pack build wasm/compress     --target web --out-dir ../../frontend/src/wasm/compress

# FlatBuffers regeneration (rare — only after schema edits).
flatc:
    flatc --rust --ts -o generated/ schemas/messages.fbs

# ── First-run setup ──────────────────────────────────────────────
# Generate local TLS certificates. Idempotent.
certs:
    bash scripts/setup-certs.sh

# Install the mkcert CA into the system trust store (one-time).
certs-install:
    mkcert -install

# ── Demo / public-readiness helpers ──────────────────────────────
# Start a full stack, seed fixtures, open the browser.
demo: certs build wasm
    NOAIDE_WATCH_PATHS=$(pwd)/frontend/e2e/fixtures/claude-home \
    NOAIDE_PLAN_DIR=$(pwd)/frontend/e2e/fixtures/plans \
    ./target/release/noaide-server &
    sleep 3
    cd frontend && pnpm preview &
    sleep 2
    xdg-open http://localhost:4173/noaide/ 2>/dev/null || \
      open http://localhost:4173/noaide/ 2>/dev/null || \
      echo "Open http://localhost:4173/noaide/ in your browser"
