# Contributing

Thank you for considering contributing to noaide!

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

## Development

### Self-hosted Runner Setup

The CI/CD pipeline runs on a self-hosted GitHub Actions runner. To set up a new runner:

```bash
ssh root@<runner-host> "bash -s" < scripts/setup-runner.sh
```

Required tools are installed automatically: Rust (stable+nightly), Node.js 22, wasm-pack, flatc, mkcert, gitleaks, cargo-audit, Docker, bpf-linker.

## Parallel Work (Multi-Agent Development)

noaide supports parallel development by multiple AI coding agents. Each work package
is a self-contained GitHub Issue with clear boundaries.

### Rules for Parallel Branches

1. **One work package = one branch.** Always branch from `main`:
   ```bash
   git checkout -b feat/wp3-event-bus main
   ```
2. **Never commit directly to `main`.** Branch protection enforces PRs.
3. **Respect file boundaries.** Each issue specifies:
   - **In Scope:** Files you may modify
   - **Out of Scope:** Files you must NOT touch
4. **Interface contracts.** Shared types, traits, and topics are defined in the issue.
   Implement against the contract, not against other agents' code.
5. **Rebase before PR.** Always rebase onto the latest `main` before creating a PR:
   ```bash
   git fetch origin && git rebase origin/main
   ```
6. **Merge order follows dependencies.** Check the dependency graph in the issue.
   If your WP depends on another, wait for it to merge first.

### Sprint Milestones

Work packages are grouped into sprint milestones (S1-S4) on GitHub.
Milestones define which WPs can run in parallel and which must be sequential.

## Architecture

All 11 Architecture Decision Records (ADRs) are summarized in [llms.txt](llms.txt).
See the [README](README.md) for the overall system architecture diagram.
