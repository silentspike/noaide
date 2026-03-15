import { createSignal, createResource, createEffect, onCleanup, For, Show } from "solid-js";
import { StandalonePlanProvider } from "./stores/planProvider";
import TOGAFDashboard from "./TOGAFDashboard";

interface PlanEntry {
  name: string;
  has_plan_json: boolean;
  has_edits: boolean;
}

async function fetchPlans(): Promise<PlanEntry[]> {
  const res = await fetch("/api/plans");
  if (!res.ok) return [];
  return res.json();
}

async function fetchPlanForSession(sessionId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/plans/for-session/${sessionId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.plan ?? null;
  } catch { return null; }
}

interface PlanSelectorProps {
  /** Currently selected session ID — auto-selects the bound plan */
  sessionId?: string;
}

/**
 * PlanSelector — scans /work/plan/ for available plans,
 * shows a dropdown, and wraps TOGAFDashboard in a PlanProvider
 * pointing at the selected plan's plan.json via nginx.
 */
export function PlanSelector(props: PlanSelectorProps) {
  const [plans, { refetch }] = createResource(fetchPlans);
  const [selected, setSelected] = createSignal<string | null>(null);

  // Auto-select first plan with plan.json
  const autoSelect = () => {
    const list = plans();
    if (!list || list.length === 0) return;
    const current = selected();
    if (current && list.some((p) => p.name === current)) return;
    const withJson = list.find((p) => p.has_plan_json);
    if (withJson) setSelected(withJson.name);
  };

  // Auto-select plan bound to current session
  createEffect(() => {
    const sid = props.sessionId;
    if (sid) {
      fetchPlanForSession(sid).then((plan) => {
        if (plan) setSelected(plan);
      });
    }
  });

  // Re-check plans periodically (every 10s) for new plans
  const intervalId = setInterval(() => { refetch(); }, 10000);
  onCleanup(() => clearInterval(intervalId));

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--ctp-surface0)",
          "background": "var(--ctp-mantle)",
          "flex-shrink": "0",
        }}
      >
        <span style={{ color: "var(--ctp-subtext0)", "font-size": "12px" }}>Plan:</span>
        <Show
          when={plans() && plans()!.length > 0}
          fallback={
            <span style={{ color: "var(--ctp-subtext0)", "font-size": "12px", "font-style": "italic" }}>
              Kein Plan gefunden. Starte eine Session und nutze /impl-plan.
            </span>
          }
        >
          {(() => { autoSelect(); return null; })()}
          <select
            data-testid="plan-selector-dropdown"
            ref={(el) => {
              // Sync initial value after options render
              queueMicrotask(() => { if (selected() && el.value !== selected()) el.value = selected()!; });
              // Listen for programmatic changes via custom event
              el.addEventListener("plan-select", (e: Event) => {
                setSelected((e as CustomEvent).detail ?? null);
              });
            }}
            onInput={(e) => setSelected(e.currentTarget.value || null)}
            onChange={(e) => setSelected(e.currentTarget.value || null)}
            style={{
              background: "var(--ctp-surface0)",
              color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)",
              "border-radius": "4px",
              padding: "4px 8px",
              "font-size": "12px",
              cursor: "pointer",
            }}
          >
            <For each={plans()!.filter((p) => p.has_plan_json)}>
              {(plan) => <option value={plan.name}>{plan.name}</option>}
            </For>
          </select>
          <Show when={plans()!.find((p) => p.name === selected())?.has_edits}>
            <span
              style={{
                "font-size": "10px",
                color: "var(--ctp-yellow)",
                background: "var(--ctp-surface0)",
                padding: "2px 6px",
                "border-radius": "3px",
              }}
            >
              Edits pending
            </span>
          </Show>
        </Show>
      </div>
      <div style={{ flex: "1", overflow: "hidden" }}>
        <Show when={selected()}>
          {(name) => (
            <StandalonePlanProvider
              planUrl={`/api/plans/${name()}/plan.json`}
              planName={name()}
              pollIntervalMs={2000}
            >
              <TOGAFDashboard />
            </StandalonePlanProvider>
          )}
        </Show>
      </div>
    </div>
  );
}
