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
          {/* Custom dropdown — SolidJS native <select> doesn't sync on programmatic changes */}
          {(() => {
            const [open, setOpen] = createSignal(false);
            const available = () => plans()!.filter((p: PlanEntry) => p.has_plan_json);
            let dropRef: HTMLDivElement | undefined;

            // Close on click outside
            const handleClickOutside = (e: MouseEvent) => {
              if (dropRef && !dropRef.contains(e.target as Node)) setOpen(false);
            };
            document.addEventListener("mousedown", handleClickOutside);
            onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));

            return (
              <div
                ref={dropRef}
                data-testid="plan-selector"
                style={{ position: "relative", "min-width": "120px" }}
              >
                <button
                  data-testid="plan-selector-toggle"
                  onClick={() => setOpen((v) => !v)}
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    gap: "6px",
                    width: "100%",
                    background: "var(--ctp-surface0)",
                    color: "var(--ctp-text)",
                    border: "1px solid var(--ctp-surface1)",
                    "border-radius": "4px",
                    padding: "4px 8px",
                    "font-size": "12px",
                    "font-family": "var(--font-mono)",
                    cursor: "pointer",
                    "text-align": "left",
                  }}
                >
                  <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                    {selected() ?? "Select plan..."}
                  </span>
                  <span style={{ "font-size": "8px", opacity: "0.6" }}>{open() ? "\u25B2" : "\u25BC"}</span>
                </button>
                <Show when={open()}>
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: "0",
                      right: "0",
                      "z-index": "100",
                      background: "var(--ctp-surface0)",
                      border: "1px solid var(--ctp-surface1)",
                      "border-radius": "0 0 4px 4px",
                      "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
                      "max-height": "200px",
                      overflow: "auto",
                    }}
                  >
                    <For each={available()}>
                      {(plan: PlanEntry) => (
                        <button
                          data-testid={`plan-option-${plan.name}`}
                          onClick={() => { setSelected(plan.name); setOpen(false); }}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: "6px 8px",
                            background: plan.name === selected() ? "var(--ctp-surface1)" : "transparent",
                            border: "none",
                            color: plan.name === selected() ? "var(--ctp-text)" : "var(--ctp-subtext0)",
                            "font-size": "12px",
                            "font-family": "var(--font-mono)",
                            cursor: "pointer",
                            "text-align": "left",
                          }}
                          onMouseEnter={(e) => { if (plan.name !== selected()) (e.currentTarget as HTMLElement).style.background = "var(--ctp-surface1)"; }}
                          onMouseLeave={(e) => { if (plan.name !== selected()) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          {plan.name}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            );
          })()}
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
