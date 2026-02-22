// ============================================================
// ADRTable — Sortable ADR table with expandable details
// Design: matches plan-noaide.html table styling
// ============================================================

import { type Component, For, createSignal, Show } from "solid-js";
import { usePlan } from "../stores/planProvider";
import type { ADR } from "../types/plan";

const STATUS_BADGE: Record<string, string> = {
  Accepted: "badge-green",
  Proposed: "badge-yellow",
  Deprecated: "badge-red",
  Superseded: "badge-lavender",
};

export const ADRTable: Component = () => {
  const store = usePlan();
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  return (
    <div class="section">
      <div class="section-header" style={{ cursor: "default" }}>
        <span class="section-icon">&#128221;</span>
        <h2>Architecture Decision Records ({store.plan.adrs.length})</h2>
      </div>
      <div class="section-body">
        <table class="togaf-table">
          <thead>
            <tr>
              <th style={{ width: "70px" }}>ID</th>
              <th>Decision</th>
              <th style={{ width: "100px" }}>Status</th>
              <th>Context</th>
            </tr>
          </thead>
          <tbody>
            <For each={store.plan.adrs}>
              {(adr) => (
                <>
                  <tr
                    onClick={() => setExpandedId(expandedId() === adr.id ? null : adr.id)}
                    style={{
                      cursor: "pointer",
                      background: expandedId() === adr.id ? "var(--bg-hover)" : undefined,
                    }}
                  >
                    <td style={{ "font-weight": "700", color: "var(--blue)" }}>
                      {adr.id}
                    </td>
                    <td>{adr.title}</td>
                    <td>
                      <span class={`badge ${STATUS_BADGE[adr.status] ?? "badge-peach"}`}>
                        {adr.status}
                      </span>
                    </td>
                    <td style={{
                      "max-width": "300px",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                      color: "var(--text-secondary)",
                    }}>
                      {adr.context}
                    </td>
                  </tr>
                  <Show when={expandedId() === adr.id}>
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "1rem 1rem 1rem 2rem",
                          background: "var(--bg-secondary)",
                        }}
                      >
                        <ADRDetails adr={adr} />
                      </td>
                    </tr>
                  </Show>
                </>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ADRDetails: Component<{ adr: ADR }> = (props) => (
  <div style={{
    display: "grid", "grid-template-columns": "1fr 1fr",
    gap: "1rem", "font-size": "0.9rem",
  }}>
    <DetailBlock label="Context" text={props.adr.context} />
    <DetailBlock label="Rationale" text={props.adr.decision} />
    <DetailBlock label="Alternatives" text={props.adr.alternatives} />
    <DetailBlock label="Consequences" text={props.adr.consequences} />
  </div>
);

const DetailBlock: Component<{ label: string; text: string }> = (props) => (
  <div>
    <span style={{
      "font-size": "0.75rem", "font-weight": "600",
      color: "var(--text-muted)", "text-transform": "uppercase",
      "letter-spacing": "0.04em", display: "block", "margin-bottom": "4px",
    }}>
      {props.label}
    </span>
    <span style={{ color: "var(--text-primary)", "line-height": "1.5" }}>
      {props.text || "\u2014"}
    </span>
  </div>
);
