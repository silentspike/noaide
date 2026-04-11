import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { useSession } from "../../App";

interface KeyStatus {
  id: string;
  provider: string;
  label: string;
  active: boolean;
  rate_limit_5h: number;
  rate_limit_7d: number;
  request_count: number;
}

export default function RateLimitPanel() {
  const store = useSession();
  const [expanded, setExpanded] = createSignal(false);
  const [keys, setKeys] = createSignal<KeyStatus[]>([]);

  function apiBase() {
    return store.state.httpApiUrl || window.location.origin;
  }

  async function fetchStatus() {
    const base = apiBase();
    if (!base) return;
    try {
      const res = await fetch(`${base}/api/proxy/keys/status`);
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch { /* ignore */ }
  }

  onMount(() => {
    void fetchStatus();
    const interval = setInterval(function() { void fetchStatus(); }, 5000);
    onCleanup(() => clearInterval(interval));
  });

  function barColor(pct: number): string {
    if (pct >= 80) return "var(--ctp-red)";
    if (pct >= 50) return "var(--ctp-yellow)";
    return "var(--ctp-green)";
  }

  const hasWarning = () =>
    keys().some((key) => key.rate_limit_5h >= 80 || key.rate_limit_7d >= 80);

  return (
    <div
      data-testid="rate-limit-panel"
      style={{
        padding: "8px 12px",
        "border-top": "1px solid var(--ctp-surface0)",
        background: "var(--ctp-mantle)",
      }}
    >
      <button
        data-testid="rate-limit-section"
        onClick={() => {
          const next = !expanded();
          setExpanded(next);
          if (next) {
            void fetchStatus();
          }
        }}
        style={{
          width: "100%",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          gap: "8px",
          padding: "0",
          background: "transparent",
          border: "none",
          color: "var(--ctp-text)",
          cursor: "pointer",
          "font-size": "11px",
          "font-weight": "600",
        }}
      >
        <span>Rate Limits</span>
        <span style={{ "font-size": "9px", color: "var(--ctp-overlay0)" }}>
          {keys().length} keys
        </span>
      </button>

      <Show when={expanded()}>
        <div style={{ display: "grid", gap: "6px", "margin-top": "6px" }}>
          <div
            data-testid="rate-limit-warning"
            style={{
              display: hasWarning() ? "block" : "none",
              padding: "6px 8px",
              background: "color-mix(in srgb, var(--ctp-red) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--ctp-red) 35%, transparent)",
              "border-radius": "6px",
              color: "var(--ctp-red)",
              "font-size": "9px",
              "font-weight": "700",
            }}
          >
            High rate-limit utilization detected
          </div>

          <Show when={keys().length > 0} fallback={<div style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>No API keys configured</div>}>
            <For each={keys()}>
              {(key) => (
                <div style={{ "margin-bottom": "6px" }}>
                  <div style={{ display: "flex", "justify-content": "space-between", "font-size": "10px", "margin-bottom": "2px" }}>
                    <span style={{ color: key.active ? "var(--ctp-text)" : "var(--ctp-overlay0)" }}>
                      {key.label} ({key.provider})
                    </span>
                    <span style={{ color: "var(--ctp-overlay0)" }}>{key.request_count} reqs</span>
                  </div>
                  <div
                    data-testid="rate-limit-bar"
                    style={{ display: "flex", "align-items": "center", gap: "4px", "margin-bottom": "1px" }}
                  >
                    <span style={{ "font-size": "8px", color: "var(--ctp-overlay0)", width: "20px" }}>5h</span>
                    <div style={{ flex: "1", height: "6px", background: "var(--ctp-surface0)", "border-radius": "3px", overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.min(key.rate_limit_5h, 100)}%`,
                        height: "100%",
                        background: barColor(key.rate_limit_5h),
                        "border-radius": "3px",
                        transition: "width 300ms ease",
                      }} />
                    </div>
                    <span style={{ "font-size": "8px", color: barColor(key.rate_limit_5h), width: "28px", "text-align": "right" }}>
                      {key.rate_limit_5h.toFixed(0)}%
                    </span>
                  </div>
                  <div
                    data-testid="rate-limit-bar"
                    style={{ display: "flex", "align-items": "center", gap: "4px" }}
                  >
                    <span style={{ "font-size": "8px", color: "var(--ctp-overlay0)", width: "20px" }}>7d</span>
                    <div style={{ flex: "1", height: "6px", background: "var(--ctp-surface0)", "border-radius": "3px", overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.min(key.rate_limit_7d, 100)}%`,
                        height: "100%",
                        background: barColor(key.rate_limit_7d),
                        "border-radius": "3px",
                        transition: "width 300ms ease",
                      }} />
                    </div>
                    <span style={{ "font-size": "8px", color: barColor(key.rate_limit_7d), width: "28px", "text-align": "right" }}>
                      {key.rate_limit_7d.toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
