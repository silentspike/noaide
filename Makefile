# Makefile — fallback for users without `just`
# The authoritative task definitions live in `justfile`. This mirror
# wraps the same commands so `make <target>` works identically.

.PHONY: help default dev dev-stop dev-front dev-backend-native dev-front-native \
        test test-rust test-front test-e2e fmt fmt-check lint audit bench \
        build wasm flatc certs certs-install demo

default: help

help:
	@echo "Available targets:"
	@echo "  dev                 — docker compose up (backend)"
	@echo "  dev-stop            — docker compose down"
	@echo "  dev-front           — frontend dev server with HMR"
	@echo "  dev-backend-native  — cargo run without docker"
	@echo "  dev-front-native    — frontend dev server without docker"
	@echo "  test                — cargo test + pnpm test"
	@echo "  test-rust           — cargo test --workspace"
	@echo "  test-front          — pnpm test"
	@echo "  test-e2e            — Playwright smoke suite"
	@echo "  fmt / fmt-check     — formatters"
	@echo "  lint                — clippy + eslint"
	@echo "  audit               — cargo audit + pnpm audit"
	@echo "  bench               — cargo bench (design goals)"
	@echo "  build               — release build of noaide-server"
	@echo "  wasm                — build all three WASM modules"
	@echo "  flatc               — regenerate FlatBuffers bindings"
	@echo "  certs               — generate local TLS certs"
	@echo "  certs-install       — install mkcert CA (one-time)"
	@echo "  demo                — build + seed fixtures + open browser"

dev:
	docker compose up --build

dev-stop:
	docker compose down

dev-front:
	cd frontend && pnpm dev

dev-backend-native:
	cargo run --bin noaide-server

dev-front-native:
	cd frontend && pnpm dev

test: test-rust test-front

test-rust:
	cargo test --workspace

test-front:
	cd frontend && pnpm test

test-e2e:
	cd frontend && pnpm run e2e

fmt:
	cargo fmt --all
	cd frontend && pnpm run format || true

fmt-check:
	cargo fmt --all -- --check
	cd frontend && pnpm run format:check || true

lint:
	cargo clippy --workspace --all-targets -- -D warnings
	cd frontend && pnpm lint

audit:
	cargo audit
	cd frontend && pnpm audit --audit-level=high

bench:
	cargo bench --workspace

build:
	cargo build --release --bin noaide-server

wasm:
	wasm-pack build wasm/jsonl-parser --target web --out-dir ../../frontend/src/wasm/jsonl-parser
	wasm-pack build wasm/markdown     --target web --out-dir ../../frontend/src/wasm/markdown
	wasm-pack build wasm/compress     --target web --out-dir ../../frontend/src/wasm/compress

flatc:
	flatc --rust --ts -o generated/ schemas/messages.fbs

certs:
	bash scripts/setup-certs.sh

certs-install:
	mkcert -install

demo: certs build wasm
	NOAIDE_WATCH_PATHS=$$(pwd)/frontend/e2e/fixtures/claude-home \
	NOAIDE_PLAN_DIR=$$(pwd)/frontend/e2e/fixtures/plans \
	./target/release/noaide-server & \
	sleep 3 && \
	cd frontend && pnpm preview & \
	sleep 2 && \
	(xdg-open http://localhost:4173/noaide/ 2>/dev/null || \
	 open http://localhost:4173/noaide/ 2>/dev/null || \
	 echo "Open http://localhost:4173/noaide/ in your browser")
