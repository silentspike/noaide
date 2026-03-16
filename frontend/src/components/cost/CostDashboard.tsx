import { createMemo, For, Show } from "solid-js";
import { useSession } from "../../App";

interface ModelCostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
  messageCount: number;
}

interface SessionCostEntry {
  id: string;
  path: string;
  cost: number;
  messageCount: number;
  model?: string;
  cliType?: string;
}

export default function CostDashboard() {
  const store = useSession();

  // Aggregate cost data from current messages
  const modelBreakdown = createMemo(() => {
    const messages = store.activeMessages();
    const byModel = new Map<string, ModelCostEntry>();

    for (const msg of messages) {
      if (msg.role !== "assistant" || !msg.model) continue;
      const key = msg.model;
      const entry = byModel.get(key) ?? {
        model: key,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        cost: 0,
        messageCount: 0,
      };
      entry.inputTokens += msg.inputTokens ?? 0;
      entry.outputTokens += msg.outputTokens ?? 0;
      entry.cacheTokens += (msg.cacheCreationInputTokens ?? 0) + (msg.cacheReadInputTokens ?? 0);
      entry.cost += msg.costUsd ?? 0;
      entry.messageCount++;
      byModel.set(key, entry);
    }

    return [...byModel.values()].sort((a, b) => b.cost - a.cost);
  });

  // Session cost overview
  const sessionCosts = createMemo(() => {
    const sessions = store.state.sessions;
    return sessions
      .filter((s) => (s.cost ?? 0) > 0)
      .map((s): SessionCostEntry => ({
        id: s.id,
        path: s.path,
        cost: s.cost ?? 0,
        messageCount: s.messageCount,
        model: s.model,
        cliType: s.cliType,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 20);
  });

  const totalCost = createMemo(() =>
    store.state.sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0),
  );

  const activeSessionCost = createMemo(() => store.totalSessionCost());

  const maxModelCost = createMemo(() =>
    Math.max(0.001, ...modelBreakdown().map((m) => m.cost)),
  );

  const totalTokens = createMemo(() => {
    const models = modelBreakdown();
    return models.reduce(
      (acc, m) => ({
        input: acc.input + m.inputTokens,
        output: acc.output + m.outputTokens,
        cache: acc.cache + m.cacheTokens,
      }),
      { input: 0, output: 0, cache: 0 },
    );
  });

  return (
    <div
      style={{
        padding: "16px",
        color: "var(--ctp-text)",
        height: "100%",
        overflow: "auto",
        "font-size": "12px",
      }}
    >
      {/* Header */}
      <h3
        style={{
          margin: "0 0 16px 0",
          "font-size": "13px",
          "font-weight": "700",
          "font-family": "var(--font-mono)",
          "text-transform": "uppercase",
          "letter-spacing": "0.06em",
          color: "var(--accent-gold, #f59e0b)",
        }}
      >
        Cost Dashboard
      </h3>

      {/* Budget Alert */}
      <Show when={totalCost() > 5.0}>
        <div
          data-testid="budget-alert"
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "8px 12px",
            "margin-bottom": "12px",
            background: totalCost() > 20 ? "rgba(243,139,168,0.1)" : "rgba(249,226,175,0.1)",
            border: `1px solid ${totalCost() > 20 ? "var(--ctp-red)" : "var(--ctp-yellow)"}`,
            "border-radius": "6px",
            "font-size": "11px",
            color: totalCost() > 20 ? "var(--ctp-red)" : "var(--ctp-yellow)",
          }}
        >
          <span style={{ "font-weight": "700" }}>{totalCost() > 20 ? "HIGH COST" : "BUDGET WARNING"}</span>
          <span>Total spend: ${totalCost().toFixed(2)} across all sessions</span>
        </div>
      </Show>

      {/* Overview Cards */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "1fr 1fr",
          gap: "10px",
          "margin-bottom": "20px",
        }}
      >
        <CostCard
          label="Active Session"
          value={`$${activeSessionCost().toFixed(4)}`}
          color="var(--neon-green, #00ff9d)"
        />
        <CostCard
          label="All Sessions"
          value={`$${totalCost().toFixed(4)}`}
          color="var(--neon-blue, #00b8ff)"
        />
      </div>

      {/* Token Breakdown */}
      <Show when={totalTokens().input + totalTokens().output + totalTokens().cache > 0}>
        <div style={{ "margin-bottom": "20px" }}>
          <SectionTitle>Token Usage (Active Session)</SectionTitle>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "1fr 1fr 1fr",
              gap: "8px",
            }}
          >
            <TokenCard
              label="Input"
              value={totalTokens().input}
              color="var(--neon-blue, #00b8ff)"
            />
            <TokenCard
              label="Output"
              value={totalTokens().output}
              color="var(--neon-green, #00ff9d)"
            />
            <TokenCard
              label="Cache"
              value={totalTokens().cache}
              color="var(--neon-purple, #a855f7)"
            />
          </div>

          {/* Token ratio bar */}
          <div style={{ "margin-top": "8px" }}>
            <TokenBar
              input={totalTokens().input}
              output={totalTokens().output}
              cache={totalTokens().cache}
            />
          </div>
        </div>
      </Show>

      {/* Per-Model Cost Breakdown */}
      <Show when={modelBreakdown().length > 0}>
        <div style={{ "margin-bottom": "20px" }}>
          <SectionTitle>Cost by Model</SectionTitle>
          <For each={modelBreakdown()}>
            {(entry) => (
              <div style={{ "margin-bottom": "8px" }}>
                <div
                  style={{
                    display: "flex",
                    "justify-content": "space-between",
                    "margin-bottom": "3px",
                  }}
                >
                  <span
                    style={{
                      "font-family": "var(--font-mono)",
                      "font-size": "11px",
                      color: "var(--ctp-text)",
                    }}
                  >
                    {entry.model.split("-").slice(0, 2).join("-")}
                  </span>
                  <span
                    style={{
                      "font-family": "var(--font-mono)",
                      "font-size": "11px",
                      "font-weight": "600",
                      color: costColor(entry.cost),
                    }}
                  >
                    ${entry.cost.toFixed(4)}
                  </span>
                </div>
                <div
                  style={{
                    height: "4px",
                    background: "var(--ctp-surface0)",
                    "border-radius": "2px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(entry.cost / maxModelCost()) * 100}%`,
                      background: costColor(entry.cost),
                      "border-radius": "2px",
                      transition: "width 300ms ease",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    "margin-top": "2px",
                    "font-size": "9px",
                    color: "var(--ctp-overlay0)",
                    "font-family": "var(--font-mono)",
                  }}
                >
                  <span>{formatTokenCount(entry.inputTokens)} in</span>
                  <span>{formatTokenCount(entry.outputTokens)} out</span>
                  <span>{entry.messageCount} msgs</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Session Cost Table */}
      <Show when={sessionCosts().length > 0}>
        <div>
          <SectionTitle>Top Sessions by Cost</SectionTitle>
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "4px",
            }}
          >
            <For each={sessionCosts()}>
              {(entry) => (
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                    padding: "6px 8px",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid var(--ctp-surface0)",
                    "border-radius": "4px",
                    cursor: "pointer",
                    transition: "background 150ms ease",
                  }}
                  onClick={() => store.setActiveSession(entry.id)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "rgba(0,184,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)";
                  }}
                >
                  <CliTypeBadge cliType={entry.cliType} />
                  <span
                    style={{
                      flex: "1",
                      "min-width": "0",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                      "font-size": "11px",
                    }}
                  >
                    {simplifyPath(entry.path)}
                  </span>
                  <span
                    style={{
                      "font-family": "var(--font-mono)",
                      "font-size": "11px",
                      "font-weight": "600",
                      "flex-shrink": "0",
                      color: costColor(entry.cost),
                    }}
                  >
                    ${entry.cost.toFixed(4)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={modelBreakdown().length === 0 && sessionCosts().length === 0}>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "center",
            height: "60%",
            color: "var(--ctp-overlay1)",
            gap: "8px",
          }}
        >
          <span style={{ "font-size": "24px", opacity: "0.3" }}>{"\u2696"}</span>
          <span
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "11px",
            }}
          >
            No cost data yet
          </span>
          <span style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>
            Costs are tracked from the first API response
          </span>
        </div>
      </Show>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────

function costColor(cost: number): string {
  if (cost < 0.01) return "var(--neon-green, #00ff9d)";
  if (cost < 0.1) return "var(--accent-gold, #f59e0b)";
  return "var(--accent-red, #ff4444)";
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function simplifyPath(path: string): string {
  if (path.startsWith("/")) {
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "work" && parts.length > 1) return parts.slice(1).join("/");
    return parts.join("/");
  }
  return path;
}

// ── Sub-components ──────────────────────────────────────

function SectionTitle(props: { children: string }) {
  return (
    <div
      style={{
        "font-size": "10px",
        "font-weight": "700",
        "font-family": "var(--font-mono)",
        "text-transform": "uppercase",
        "letter-spacing": "0.08em",
        color: "var(--ctp-subtext0)",
        "margin-bottom": "10px",
      }}
    >
      {props.children}
    </div>
  );
}

function CostCard(props: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        padding: "12px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--ctp-surface0)",
        "border-radius": "8px",
        "text-align": "center",
      }}
    >
      <div
        style={{
          "font-size": "9px",
          "font-family": "var(--font-mono)",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          color: "var(--ctp-subtext0)",
          "margin-bottom": "6px",
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          "font-size": "18px",
          "font-weight": "700",
          "font-family": "var(--font-mono)",
          color: props.color,
        }}
      >
        {props.value}
      </div>
    </div>
  );
}

function TokenCard(props: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        padding: "8px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--ctp-surface0)",
        "border-radius": "6px",
        "text-align": "center",
      }}
    >
      <div
        style={{
          "font-size": "9px",
          color: "var(--ctp-subtext0)",
          "font-family": "var(--font-mono)",
          "text-transform": "uppercase",
          "letter-spacing": "0.06em",
          "margin-bottom": "4px",
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          "font-size": "13px",
          "font-weight": "700",
          "font-family": "var(--font-mono)",
          color: props.color,
        }}
      >
        {formatTokenCount(props.value)}
      </div>
    </div>
  );
}

function TokenBar(props: { input: number; output: number; cache: number }) {
  const total = () => props.input + props.output + props.cache || 1;
  return (
    <div
      style={{
        display: "flex",
        height: "6px",
        "border-radius": "3px",
        overflow: "hidden",
        gap: "1px",
      }}
    >
      <div
        style={{
          width: `${(props.input / total()) * 100}%`,
          background: "var(--neon-blue, #00b8ff)",
          "border-radius": "3px 0 0 3px",
          transition: "width 300ms ease",
        }}
      />
      <div
        style={{
          width: `${(props.output / total()) * 100}%`,
          background: "var(--neon-green, #00ff9d)",
          transition: "width 300ms ease",
        }}
      />
      <div
        style={{
          width: `${(props.cache / total()) * 100}%`,
          background: "var(--neon-purple, #a855f7)",
          "border-radius": "0 3px 3px 0",
          transition: "width 300ms ease",
        }}
      />
    </div>
  );
}

function CliTypeBadge(props: { cliType?: string }) {
  const color = () => {
    switch (props.cliType) {
      case "codex": return "#10a37f";
      case "gemini": return "#4285f4";
      default: return "#d4a373";
    }
  };
  const label = () => {
    switch (props.cliType) {
      case "codex": return "CDX";
      case "gemini": return "GEM";
      default: return "CLD";
    }
  };
  return (
    <span
      style={{
        "font-family": "var(--font-mono)",
        "font-size": "8px",
        "font-weight": "700",
        padding: "1px 4px",
        "border-radius": "3px",
        "letter-spacing": "0.06em",
        "flex-shrink": "0",
        background: `${color()}20`,
        color: color(),
      }}
    >
      {label()}
    </span>
  );
}
