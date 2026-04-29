# Examples

Cookbook-style walkthroughs that show one concrete operator task each.
Each file is self-contained, ≤ 100 lines, and copy-pasteable. They
assume noaide is running locally — see the
[Quick Start](../README.md#quick-start) for the one-time setup.

| Walkthrough | What it covers | Tools shown |
|---|---|---|
| [`codex-session-spawn.md`](codex-session-spawn.md) | Spawn a managed agent session, route its API calls through the noaide proxy, watch the JSONL transcript | Codex • Claude Code • Gemini CLI |
| [`intercept-api-request.md`](intercept-api-request.md) | Switch the proxy to manual mode, hold an outbound request, modify it, forward or drop it | Provider-agnostic |
| [`audit-export-pattern.md`](audit-export-pattern.md) | Pull the NDJSON audit log via `/api/proxy/audit/export`, walk the schema, replay one entry against the chat panel | Provider-agnostic |

More walkthroughs welcome — see [CONTRIBUTING.md](../CONTRIBUTING.md)
for the contribution flow. Style guide: keep each example ≤ 100 lines,
prefer the smallest reproducible commands over a full runbook, and
show the expected output for every command that produces one.

## See also

- [`docs/workshop-ai-coding-rollout.md`](../docs/workshop-ai-coding-rollout.md) — the 45-minute workshop these walkthroughs feed into
- [`docs/api.md`](../docs/api.md) — the HTTP endpoints the examples call
- [`docs/agent-operating-model.md`](../docs/agent-operating-model.md) — what noaide watches and how
