# Contributing

Thank you for considering contributing to claude-ide!

## Language Policy

All GitHub content **must be in English**: issues, PRs, commits, comments, code
comments, and documentation. A CI gate enforces this automatically.

## How to Contribute

### Reporting Bugs

Use the [Bug Report](../../issues/new?template=bug_report.yml) template.
Include steps to reproduce and expected vs actual behavior.

### Suggesting Features

Use the [Feature Request](../../issues/new?template=feature_request.yml) template.
Describe the problem you are trying to solve.

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run quality gates (see below)
5. Commit using Conventional Commits
6. Push and create a Pull Request

## Quality Gates

Before submitting a PR, run these checks locally:

```bash
# Rust
cargo clippy -- -D warnings
cargo fmt -- --check
cargo test --all-features
cargo audit

# Frontend
cd frontend
npm run lint
npm test
npm audit

# WASM
wasm-pack build wasm/jsonl-parser --target web
```

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/).

Format: `type: description`

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructuring |
| `perf` | Performance improvement |
| `test` | Adding or changing tests |
| `build` | Build system or dependencies |
| `ci` | CI/CD configuration |
| `chore` | Other maintenance |
| `revert` | Reverting a commit |
| `deps` | Dependency updates |
| `security` | Security fixes |

## Branch Naming

```
feat/description      # New feature
fix/description       # Bug fix
docs/description      # Documentation
ci/description        # CI/CD
refactor/description  # Refactoring
```

## Code Style

### Rust

- `cargo clippy -- -D warnings` must pass
- `cargo fmt` for formatting
- `thiserror` for library errors, `anyhow` only in main
- ECS patterns (hecs): components are plain structs, systems are functions
- No `.clone()` on hot paths, use FlatBuffers zero-copy
- Bounded channels for backpressure

### TypeScript / SolidJS

- ESLint + Prettier must pass
- SolidJS signals only (no React patterns like useState)
- Never destructure props (breaks reactivity)
- Use Catppuccin Mocha tokens from `styles/tokens.css`
- Use Phosphor Icons exclusively

### General

- No mocks, stubs, or placeholders in production code paths
- Every feature needs tests
- Keep dependencies on latest stable versions

## Architecture

See the [Implementation Plan](IMPL-PLAN.md) for the full TOGAF ADM architecture
and all 11 Architecture Decision Records (ADRs).
