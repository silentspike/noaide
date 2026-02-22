// ============================================================
// RiskMatrix — Likelihood x Severity heatmap + risk cards
// Design: matches plan-noaide.html risk matrix styling
// ============================================================

import { type Component, For, createMemo } from "solid-js";
import { usePlan } from "../stores/planProvider";
import type { Risk, RiskLevel } from "../types/plan";

const LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];
const LEVEL_LABELS: Record<RiskLevel, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};

const SEVERITY_CLASS: Record<RiskLevel, string> = {
  critical: "risk-critical", high: "risk-high",
  medium: "risk-medium", low: "risk-low",
};

const CELL_COLORS: Record<string, string> = {
  "low-low": "risk-low", "low-medium": "risk-low", "low-high": "risk-medium", "low-critical": "risk-high",
  "medium-low": "risk-low", "medium-medium": "risk-medium", "medium-high": "risk-high", "medium-critical": "risk-critical",
  "high-low": "risk-medium", "high-medium": "risk-high", "high-high": "risk-critical", "high-critical": "risk-critical",
  "critical-low": "risk-high", "critical-medium": "risk-critical", "critical-high": "risk-critical", "critical-critical": "risk-critical",
};

export const RiskMatrix: Component = () => {
  const store = usePlan();

  const riskGrid = createMemo(() => {
    const grid: Record<string, Risk[]> = {};
    for (const risk of store.plan.risks) {
      const key = `${risk.likelihood}-${risk.severity}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(risk);
    }
    return grid;
  });

  return (
    <div class="section">
      <div class="section-header" style={{ cursor: "default" }}>
        <span class="section-icon">&#9888;</span>
        <h2>Risk Assessment ({store.plan.risks.length} Risks)</h2>
      </div>
      <div class="section-body">
        {/* Heatmap Grid */}
        <div class="risk-matrix" style={{
          "grid-template-columns": "80px repeat(4, 1fr)",
          "grid-template-rows": "30px repeat(4, 80px)",
          "max-width": "600px",
          "margin-bottom": "1.5rem",
        }}>
          {/* Header row */}
          <div />
          <For each={LEVELS}>
            {(level) => (
              <div class="risk-label">{LEVEL_LABELS[level]}</div>
            )}
          </For>

          {/* Grid rows (severity high to low) */}
          <For each={[...LEVELS].reverse()}>
            {(severity) => (
              <>
                <div class="risk-label" style={{ "justify-content": "flex-end", "padding-right": "8px" }}>
                  {LEVEL_LABELS[severity]}
                </div>
                <For each={LEVELS}>
                  {(likelihood) => {
                    const key = `${likelihood}-${severity}`;
                    const risks = () => riskGrid()[key] ?? [];
                    const cellClass = CELL_COLORS[key] ?? "";

                    return (
                      <div
                        class={`risk-cell ${risks().length > 0 ? cellClass : ""}`}
                        style={{
                          opacity: risks().length > 0 ? "1" : "0.3",
                          background: risks().length === 0 ? "var(--surface0)" : undefined,
                        }}
                        title={risks().map((r) => `${r.id}: ${r.title}`).join("\n")}
                      >
                        <For each={risks()}>
                          {(r) => <span>{r.id} </span>}
                        </For>
                      </div>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </div>

        <div style={{
          display: "flex", gap: "2rem",
          "font-size": "0.75rem", color: "var(--text-muted)",
          "margin-bottom": "1.5rem", "padding-left": "80px",
        }}>
          <span>Likelihood &rarr;</span>
          <span>&uarr; Severity</span>
        </div>

        {/* Risk detail cards */}
        <div class="wp-grid">
          <For each={store.plan.risks}>
            {(risk) => <RiskCard risk={risk} />}
          </For>
        </div>
      </div>
    </div>
  );
};

const RiskCard: Component<{ risk: Risk }> = (props) => {
  const sevClass = () => SEVERITY_CLASS[props.risk.severity] ?? "risk-info";

  return (
    <div class="wp-card" style={{
      "border-left": `4px solid`,
      "border-left-color": props.risk.severity === "critical" ? "var(--red)"
        : props.risk.severity === "high" ? "var(--peach)"
        : props.risk.severity === "medium" ? "var(--yellow)"
        : "var(--green)",
    }}>
      <div class="wp-card-header">
        <span class={`badge ${sevClass()}`} style={{ "font-size": "0.7rem" }}>
          {props.risk.id}
        </span>
        <h4>{props.risk.title}</h4>
        <span style={{ "font-size": "0.72rem", color: "var(--text-muted)" }}>
          {props.risk.owner}
        </span>
      </div>
      <div style={{
        "font-size": "0.8rem", color: "var(--text-secondary)",
        display: "flex", gap: "1rem", "margin-bottom": "0.3rem",
      }}>
        <span>Severity: <strong>{props.risk.severity}</strong></span>
        <span>Likelihood: <strong>{props.risk.likelihood}</strong></span>
      </div>
      <div style={{ "font-size": "0.78rem", color: "var(--text-muted)" }}>
        {props.risk.mitigation}
      </div>
    </div>
  );
};
