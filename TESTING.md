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

## VERIFY Protocol

Every work package must pass the VERIFY protocol before being marked as done.
The protocol ensures consistent quality across all changes.

### Steps

1. **Tests**: Run all relevant test commands, document command + output.
2. **Lint**: Confirm zero warnings from `cargo clippy` and `eslint`.
3. **Type Check**: Confirm zero errors from `tsc --noEmit`.
4. **Build**: Confirm successful `cargo build --release` and `npm run build`.
5. **Observability**: Check that new code has appropriate logging (tracing crate for Rust, console.warn/error for frontend).
6. **Lessons**: Document any unexpected issues as rules in project config to prevent recurrence.

### Evidence Template

```
## VERIFY: WP-N — <Title>

### Tests Performed
- Command: `cargo test -p noaide-server -- <module>`
  Output: <N> tests passed, 0 failed
- Command: `cd frontend && npm test`
  Output: <N> tests passed

### Tests NOT Performed
- <Description> — Reason: <why>

### Lint & Type Check
- `cargo clippy`: 0 warnings
- `eslint src/ --max-warnings 0`: 0 warnings
- `tsc --noEmit`: 0 errors

### Build
- `cargo build --release`: OK (<duration>)
- `npm run build`: OK (<bundle size>)

### Confidence: <N>%
<One sentence justification>
```

## Test Coverage

### Current Test Inventory

| Area | Test File | Tests | Type |
|------|-----------|-------|------|
| Keyboard shortcuts | `src/shortcuts/keymap.test.ts` | 3 | Unit |
| Message types & helpers | `src/types/messages.test.ts` | 15 | Unit |
| Session store | `src/stores/session.test.ts` | 15 | Unit |
| Fuzzy match (CommandPalette) | `src/components/shared/CommandPalette.test.ts` | 9 | Unit |
| File extension icons | `src/components/files/FileNode.test.ts` | 9 | Unit |
| Relative time & path helpers | `src/components/sessions/SessionCard.test.ts` | 8 | Unit |
| Rust server modules | `cargo test --all-features` | varies | Unit + Integration |

### Running Tests

```bash
# Frontend unit tests
cd frontend && npm test

# Frontend tests with coverage
cd frontend && npm test -- --coverage

# Frontend lint
cd frontend && npm run lint

# Frontend type check
cd frontend && npm run typecheck

# Rust tests (remote build server)
cargo remote -- test

# Rust lint
cargo remote -- clippy

# All CI checks locally
cd frontend && npm run lint && npm run typecheck && npm test
```

## Performance Benchmarks

| Metric | Target | Command |
|--------|--------|---------|
| File event to browser | < 50ms p99 | `cargo bench -- file_event` |
| JSONL parse rate | > 10,000 lines/sec | `cargo bench -- jsonl_parse` |
| Server RSS | < 200 MB | `cargo bench -- memory` |
| FPS at 1000+ messages | 120 Hz | Playwright perf trace |
| Zenoh SHM latency | ~1us | `cargo bench -- zenoh_shm` |
