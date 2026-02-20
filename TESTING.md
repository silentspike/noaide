# Testing Strategy

## Gate Matrix

| Gate | Required Tests | Blocking | Target Duration |
|------|----------------|----------|-----------------|
| PR | Static, Unit, Security, Build, System Artifact, Language | Yes | p95 <= 10 min |
| Main | Integration, Contract, E2E Smoke | Yes | <= 20 min |
| Nightly | Full E2E, Load/Stress Baseline, Extended Security | No | <= 60 min |
| Release | System Full, E2E Critical, NFR Thresholds | Yes | <= 45 min |

## Test Levels

| Level | Command | Environment | Evidence Path |
|-------|---------|-------------|---------------|
| Static (Rust) | `cargo clippy -- -D warnings && cargo fmt -- --check` | CI | `artifacts/clippy.log` |
| Static (Frontend) | `cd frontend && npm run lint` | CI | `artifacts/eslint.log` |
| Unit (Rust) | `cargo test --all-features` | CI | `artifacts/cargo-test.xml` |
| Unit (Frontend) | `cd frontend && npm test -- --coverage` | CI | `artifacts/coverage/` |
| Integration | `cargo test --test integration` | CI | `artifacts/integration.xml` |
| Security (Rust) | `cargo audit` | CI | `artifacts/cargo-audit.json` |
| Security (Frontend) | `npm audit --audit-level=high` | CI | `artifacts/npm-audit.json` |
| Security (SAST) | CodeQL Analysis | CI | GitHub Security tab |
| System/Artifact | `./target/release/noaide-server --version` | Release binary | `artifacts/system.log` |
| E2E/Smoke | Playwright via Docker | Ephemeral | `artifacts/e2e/` |
| Language | German content detection in GitHub files | CI | `artifacts/language-check.log` |

## Rules

- No merge without green PR gate.
- No release without green Release gate.
- `N/A` must include reason and linked follow-up issue.
- Flaky tests require dedicated tracking issue with expiration date.
- Evidence is reproducible: command + environment + result + artifact path.
- All acceptance criteria (AC-IDs) map to at least one test level.

## Performance Benchmarks

| Metric | Target | Command |
|--------|--------|---------|
| File event to browser | < 50ms p99 | `cargo bench -- file_event` |
| JSONL parse rate | > 10,000 lines/sec | `cargo bench -- jsonl_parse` |
| Server RSS | < 200 MB | `cargo bench -- memory` |
| FPS at 1000+ messages | 120 Hz | Playwright perf trace |
| Zenoh SHM latency | ~1us | `cargo bench -- zenoh_shm` |
