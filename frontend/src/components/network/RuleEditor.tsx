import { createSignal, For, Show, onMount, onCleanup, createEffect } from "solid-js";

interface NetworkRule {
  id: string;
  session_id?: string;
  domain_pattern?: string;
  category_filter?: string;
  action: RuleAction;
  enabled?: boolean;
  priority: number;
}

interface RuleEditorProps {
  sessionId: string;
  httpApiUrl: string;
  refreshKey?: number;
}

type RuleAction =
  | "allow"
  | "block"
  | { type: "allow" }
  | { type: "block" }
  | { type: "delay"; ms: number }
  | { delay: { ms: number } };

function actionType(action: RuleAction): "allow" | "block" | "delay" {
  if (typeof action === "string") return action;
  if ("type" in action) return action.type;
  return "delay";
}

function actionLabel(action: RuleAction): string {
  if (typeof action !== "string") {
    if ("ms" in action) return `DELAY ${action.ms}ms`;
    if ("delay" in action) return `DELAY ${action.delay.ms}ms`;
  }
  return actionType(action).toUpperCase();
}

export default function RuleEditor(props: RuleEditorProps) {
  const [rules, setRules] = createSignal<NetworkRule[]>([]);
  const [newDomain, setNewDomain] = createSignal("");
  const [newCategory, setNewCategory] = createSignal("");
  const [newAction, setNewAction] = createSignal<"allow" | "block">("block");
  const [newPriority, _setNewPriority] = createSignal(50);

  async function fetchRules() {
    try {
      const res = await fetch(`${props.httpApiUrl}/api/proxy/network-rules/${props.sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setRules(Array.isArray(data) ? data : data.rules || []);
      }
    } catch { /* ignore */ }
  }

  async function addRule() {
    const body: Record<string, unknown> = {
      id: "",
      session_id: props.sessionId,
      action: { type: newAction() },
      enabled: true,
      priority: newPriority(),
    };
    if (newDomain()) body.domain_pattern = newDomain();
    if (newCategory()) body.category_filter = newCategory().toLowerCase();

    try {
      await fetch(`${props.httpApiUrl}/api/proxy/network-rules/${props.sessionId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setNewDomain("");
      setNewCategory("");
      await fetchRules();
    } catch { /* ignore */ }
  }

  async function deleteRule(ruleId: string) {
    try {
      await fetch(`${props.httpApiUrl}/api/proxy/network-rules/${props.sessionId}/rules/${ruleId}`, {
        method: "DELETE",
      });
      await fetchRules();
    } catch { /* ignore */ }
  }

  onMount(() => {
    fetchRules();
    const interval = setInterval(fetchRules, 5000);
    onCleanup(() => clearInterval(interval));
  });

  createEffect(() => {
    props.sessionId;
    props.httpApiUrl;
    setRules([]);
    void fetchRules();
  });

  createEffect(() => {
    props.refreshKey;
    void fetchRules();
  });

  return (
    <div
      data-testid="rule-editor"
      style={{
        padding: "8px 12px",
        "border-top": "1px solid var(--ctp-surface0)",
        background: "var(--ctp-mantle)",
        "max-height": "250px",
        overflow: "auto",
      }}
    >
      <div
        style={{
          "font-size": "11px",
          "font-weight": "600",
          color: "var(--ctp-text)",
          "margin-bottom": "6px",
        }}
      >
        Network Rules
      </div>

      {/* Existing rules list */}
      <Show
        when={rules().length > 0}
        fallback={
          <div
            style={{
              "font-size": "10px",
              color: "var(--ctp-overlay0)",
              "margin-bottom": "8px",
            }}
          >
            No rules configured
          </div>
        }
      >
        <div style={{ "margin-bottom": "8px" }}>
          <For each={rules()}>
            {(rule) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  padding: "3px 0",
                  "font-size": "11px",
                  "border-bottom": "1px solid var(--ctp-surface0)",
                }}
              >
                <span
                  style={{
                    padding: "1px 6px",
                    "border-radius": "3px",
                    "font-size": "9px",
                    "font-weight": "600",
                    background:
                      actionType(rule.action) === "block"
                        ? "var(--ctp-red)"
                        : actionType(rule.action) === "allow"
                          ? "var(--ctp-green)"
                          : "var(--ctp-yellow)",
                    color: "var(--ctp-base)",
                  }}
                >
                  {actionLabel(rule.action)}
                </span>
                <span style={{ color: "var(--ctp-text)", flex: "1" }}>
                  {rule.domain_pattern || rule.category_filter || "any"}
                </span>
                <span
                  style={{
                    "font-size": "9px",
                    color: "var(--ctp-overlay0)",
                  }}
                >
                  p{rule.priority}
                </span>
                <button
                  onClick={() => deleteRule(rule.id)}
                  style={{
                    padding: "1px 4px",
                    "font-size": "9px",
                    background: "transparent",
                    border: "1px solid var(--ctp-surface1)",
                    "border-radius": "3px",
                    color: "var(--ctp-red)",
                    cursor: "pointer",
                  }}
                >
                  x
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Add rule form */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          "align-items": "center",
          "flex-wrap": "wrap",
        }}
      >
        <input
          data-testid="rule-domain-input"
          type="text"
          placeholder="*.domain.com"
          value={newDomain()}
          onInput={(e) => setNewDomain(e.currentTarget.value)}
          style={{
            flex: "1",
            "min-width": "120px",
            padding: "3px 6px",
            "font-size": "10px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "3px",
            color: "var(--ctp-text)",
            outline: "none",
          }}
        />
        <select
          data-testid="rule-category-select"
          value={newCategory()}
          onChange={(e) => setNewCategory(e.currentTarget.value)}
          style={{
            padding: "3px 6px",
            "font-size": "10px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "3px",
            color: "var(--ctp-text)",
          }}
        >
          <option value="">Any Category</option>
          <option value="Api">Api</option>
          <option value="Telemetry">Telemetry</option>
          <option value="Auth">Auth</option>
          <option value="Update">Update</option>
          <option value="Git">Git</option>
        </select>
        <select
          data-testid="rule-action-select"
          value={newAction()}
          onChange={(e) =>
            setNewAction(e.currentTarget.value as "allow" | "block")
          }
          style={{
            padding: "3px 6px",
            "font-size": "10px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "3px",
            color: "var(--ctp-text)",
          }}
        >
          <option value="block">Block</option>
          <option value="allow">Allow</option>
        </select>
        <button
          data-testid="rule-add-btn"
          onClick={addRule}
          style={{
            padding: "3px 8px",
            "font-size": "10px",
            "font-weight": "600",
            background: "var(--ctp-blue)",
            border: "none",
            "border-radius": "3px",
            color: "var(--ctp-base)",
            cursor: "pointer",
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
