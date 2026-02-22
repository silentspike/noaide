// ============================================================
// WorkPackageGrid — Auto-fill WP cards with verify checks
// Design: matches plan-noaide.html WP card styling
// ============================================================

import { type Component, For, createSignal, createMemo, Show } from "solid-js";
import { usePlan } from "../stores/planProvider";
import type { WorkPackage } from "../types/plan";

const SIZE_BADGE: Record<string, string> = {
  S: "badge-green", M: "badge-blue", L: "badge-peach",
};

const STATUS_BADGE: Record<string, string> = {
  backlog: "badge-lavender", analysis: "badge-mauve",
  ready: "badge-blue", in_progress: "badge-yellow",
  review: "badge-peach", done: "badge-green",
};

export const WorkPackageGrid: Component = () => {
  const store = usePlan();
  const [expandedWP, setExpandedWP] = createSignal<string | null>(null);

  return (
    <div class="section">
      <div class="section-header" style={{ cursor: "default" }}>
        <span class="section-icon">&#128230;</span>
        <h2>Work Packages ({store.plan.work_packages.length})</h2>
      </div>
      <div class="section-body">
        <div class="wp-grid">
          <For each={store.plan.work_packages}>
            {(wp) => (
              <WPDetailCard
                wp={wp}
                expanded={expandedWP() === wp.id}
                onToggle={() => setExpandedWP(expandedWP() === wp.id ? null : wp.id)}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

interface WPDetailProps {
  wp: WorkPackage;
  expanded: boolean;
  onToggle: () => void;
}

const WPDetailCard: Component<WPDetailProps> = (props) => {
  const verifyDone = createMemo(() => props.wp.verify_checks.filter((c) => c.passed).length);
  const verifyTotal = createMemo(() => props.wp.verify_checks.length);
  const verifyPct = () => verifyTotal() > 0 ? Math.round((verifyDone() / verifyTotal()) * 100) : 0;

  return (
    <div class="wp-card">
      <div class="wp-card-header" onClick={() => props.onToggle()} style={{ cursor: "pointer" }}>
        <span style={{ "font-weight": "700", color: "var(--blue)", "font-size": "0.85rem" }}>
          {props.wp.id}
        </span>
        <h4>{props.wp.title}</h4>
        <span class={`badge ${SIZE_BADGE[props.wp.size] ?? "badge-blue"}`}
              style={{ "font-size": "0.65rem" }}>
          {props.wp.size}
        </span>
        <span class={`badge ${STATUS_BADGE[props.wp.status] ?? "badge-lavender"}`}
              style={{ "font-size": "0.6rem", "text-transform": "uppercase" }}>
          {props.wp.status.replace("_", " ")}
        </span>
      </div>

      {/* Verify progress */}
      {verifyTotal() > 0 && (
        <div style={{ padding: "0 0.8rem 0.4rem" }}>
          <div class="confidence-bar">
            <div class="confidence-track" style={{ height: "6px" }}>
              <div class="confidence-fill" style={{ width: `${verifyPct()}%` }} />
            </div>
            <span style={{ "font-size": "0.72rem", color: "var(--text-muted)" }}>
              {verifyDone()}/{verifyTotal()} verified
            </span>
          </div>
        </div>
      )}

      {/* Dependencies */}
      {props.wp.dependencies.length > 0 && (
        <div class="wp-deps" style={{ padding: "0 0.8rem 0.4rem" }}>
          blocked by: {props.wp.dependencies.join(", ")}
        </div>
      )}

      {/* Gate indicator */}
      {props.wp.gate_required && (
        <div style={{ padding: "0 0.8rem 0.4rem" }}>
          <span class="gate-badge">Gate</span>
        </div>
      )}

      {/* Expanded details */}
      <Show when={props.expanded}>
        <div style={{
          padding: "0.8rem",
          "border-top": "1px solid var(--border)",
          "font-size": "0.82rem",
        }}>
          <div style={{ display: "flex", gap: "1rem", "margin-bottom": "0.5rem", color: "var(--text-secondary)" }}>
            <span>Complexity: {props.wp.complexity}</span>
          </div>

          {verifyTotal() > 0 && (
            <div>
              <span style={{
                "font-size": "0.78rem", "font-weight": "600",
                color: "var(--text-secondary)", "text-transform": "uppercase",
                "letter-spacing": "0.04em", display: "block", "margin-bottom": "4px",
              }}>
                Verify Checks
              </span>
              <ul class="checklist">
                <For each={props.wp.verify_checks}>
                  {(check) => (
                    <li>
                      <span class={`check-icon ${check.passed ? "check-pass" : "check-open"}`}>
                        {check.passed ? "\u2713" : "\u25CB"}
                      </span>
                      {check.description}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}

          {props.wp.scope_files.length > 0 && (
            <div style={{ "margin-top": "0.5rem" }}>
              <span style={{
                "font-size": "0.78rem", "font-weight": "600",
                color: "var(--text-secondary)", display: "block", "margin-bottom": "4px",
              }}>
                Scope
              </span>
              <For each={props.wp.scope_files}>
                {(file) => (
                  <div style={{ "font-size": "0.78rem", color: "var(--text-muted)" }}>
                    <code>{file}</code>
                  </div>
                )}
              </For>
            </div>
          )}
        </div>
      </Show>
    </div>
  );
};
