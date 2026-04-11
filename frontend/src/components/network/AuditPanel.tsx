import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { useSession } from "../../App";

interface AuditEntry {
  id: string;
  session_id: string | null;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  timestamp: number;
  latency_ms: number;
  method: string;
  url: string;
}

export default function AuditPanel() {
  const store = useSession();
  const [expanded, setExpanded] = createSignal(false);
  const [entries, setEntries] = createSignal<AuditEntry[]>([]);

  function apiBase() {
    return store.state.httpApiUrl || window.location.origin;
  }

  async function fetchAudit() {
    const base = apiBase();
    if (!base) return;
    const sid = store.state.activeSessionId;
    const url = sid
      ? `${base}/api/proxy/audit?session_id=${sid}&limit=50`
      : `${base}/api/proxy/audit?limit=50`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch { /* ignore */ }
  }

  function exportCsv() {
    const base = apiBase();
    if (!base) return;
    window.open(`${base}/api/proxy/audit/export?format=csv&limit=10000`, "_blank");
  }

  function exportJson() {
    const base = apiBase();
    if (!base) return;
    window.open(`${base}/api/proxy/audit/export?format=json&limit=10000`, "_blank");
  }

  onMount(() => {
    void fetchAudit();
    const interval = setInterval(function() { void fetchAudit(); }, 10000);
    onCleanup(() => clearInterval(interval));
  });

  const totalCost = () => entries().reduce((sum, e) => sum + e.cost_usd, 0);

  return (
    <div
      data-testid="audit-panel"
      style={{
        padding: "8px 12px",
        "border-top": "1px solid var(--ctp-surface0)",
        background: "var(--ctp-mantle)",
        "max-height": "300px",
        overflow: "auto",
      }}
    >
      <button
        data-testid="audit-section"
        onClick={() => {
          const next = !expanded();
          setExpanded(next);
          if (next) {
            void fetchAudit();
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
        <span>Audit Log — ${totalCost().toFixed(4)}</span>
        <span style={{ "font-size": "9px", color: "var(--ctp-overlay0)" }}>
          {entries().length} entries
        </span>
      </button>

      <Show when={expanded()}>
        <div style={{ display: "grid", gap: "6px", "margin-top": "6px" }}>
          <div style={{ display: "flex", "justify-content": "flex-end", gap: "6px" }}>
            <button
              data-testid="audit-export-csv"
              onClick={exportCsv}
              style={{
                padding: "2px 6px",
                "font-size": "9px",
                background: "var(--ctp-surface0)",
                border: "1px solid var(--ctp-surface1)",
                "border-radius": "3px",
                color: "var(--ctp-subtext0)",
                cursor: "pointer",
              }}
            >
              CSV
            </button>
            <button
              data-testid="audit-export-json"
              onClick={exportJson}
              style={{
                padding: "2px 6px",
                "font-size": "9px",
                background: "var(--ctp-surface0)",
                border: "1px solid var(--ctp-surface1)",
                "border-radius": "3px",
                color: "var(--ctp-subtext0)",
                cursor: "pointer",
              }}
            >
              JSON
            </button>
          </div>

          <table
            data-testid="audit-table"
            style={{ width: "100%", "font-size": "10px", "border-collapse": "collapse" }}
          >
            <thead>
              <tr style={{ color: "var(--ctp-overlay0)", "text-align": "left" }}>
                <th style={{ padding: "2px 4px" }}>Time</th>
                <th style={{ padding: "2px 4px" }}>Model</th>
                <th style={{ padding: "2px 4px" }}>In</th>
                <th style={{ padding: "2px 4px" }}>Out</th>
                <th style={{ padding: "2px 4px" }}>Cost</th>
                <th style={{ padding: "2px 4px" }}>Latency</th>
              </tr>
            </thead>
            <tbody>
              <Show
                when={entries().length > 0}
                fallback={(
                  <tr style={{ "border-top": "1px solid var(--ctp-surface0)" }}>
                    <td colSpan={6} style={{ padding: "6px 4px", color: "var(--ctp-overlay0)" }}>
                      No audit entries
                    </td>
                  </tr>
                )}
              >
                <For each={entries()}>
                  {(entry) => (
                    <tr style={{ "border-top": "1px solid var(--ctp-surface0)" }}>
                      <td style={{ padding: "2px 4px", color: "var(--ctp-overlay1)" }}>
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: "2px 4px", color: "var(--ctp-blue)" }}>{entry.model}</td>
                      <td style={{ padding: "2px 4px", color: "var(--ctp-text)" }}>{entry.input_tokens}</td>
                      <td style={{ padding: "2px 4px", color: "var(--ctp-text)" }}>{entry.output_tokens}</td>
                      <td style={{ padding: "2px 4px", color: "var(--ctp-green)" }}>${entry.cost_usd.toFixed(4)}</td>
                      <td style={{ padding: "2px 4px", color: "var(--ctp-overlay1)" }}>{entry.latency_ms}ms</td>
                    </tr>
                  )}
                </For>
              </Show>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
