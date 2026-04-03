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
  const [keys, setKeys] = createSignal<KeyStatus[]>([]);

  async function fetchStatus() {
    const base = store.state.httpApiUrl;
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

  return (
    <div
      data-testid="rate-limit-panel"
      style={{
        padding: "8px 12px",
        "border-top": "1px solid var(--ctp-surface0)",
        background: "var(--ctp-mantle)",
      }}
    >
      <div style={{ "font-size": "11px", "font-weight": "600", color: "var(--ctp-text)", "margin-bottom": "6px" }}>
        Rate Limits
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
              {/* 5h bar */}
              <div style={{ display: "flex", "align-items": "center", gap: "4px", "margin-bottom": "1px" }}>
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
              {/* 7d bar */}
              <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
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
  );
}
