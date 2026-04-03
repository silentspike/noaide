import { createSignal, Show, onMount } from "solid-js";
import { useSession } from "../../App";

export default function RewritePanel() {
  const store = useSession();
  const [modelOverride, setModelOverride] = createSignal("");
  const [temperature, setTemperature] = createSignal<number | null>(null);
  const [maxTokens, setMaxTokens] = createSignal<number | null>(null);
  const [thinkingType, setThinkingType] = createSignal("");
  const [pureMode, setPureMode] = createSignal(false);

  async function fetchConfig() {
    const base = store.state.httpApiUrl;
    const sid = store.state.activeSessionId;
    if (!base || !sid) return;
    try {
      const res = await fetch(`${base}/api/proxy/rewrite/${sid}`);
      if (res.ok) {
        const data = await res.json();
        setModelOverride(data.model_override || "");
        setTemperature(data.temperature ?? null);
        setMaxTokens(data.max_tokens ?? null);
        setThinkingType(data.thinking_type || "");
        setPureMode(data.pure_mode || false);
      }
    } catch { /* ignore */ }
  }

  async function saveConfig() {
    const base = store.state.httpApiUrl;
    const sid = store.state.activeSessionId;
    if (!base || !sid) return;
    try {
      await fetch(`${base}/api/proxy/rewrite/${sid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_override: modelOverride() || null,
          temperature: temperature(),
          max_tokens: maxTokens(),
          thinking_type: thinkingType() || null,
          pure_mode: pureMode(),
        }),
      });
    } catch { /* ignore */ }
  }

  onMount(() => {
    void fetchConfig();
  });

  const inputStyle = {
    padding: "3px 6px",
    "font-size": "10px",
    background: "var(--ctp-surface0)",
    border: "1px solid var(--ctp-surface1)",
    "border-radius": "3px",
    color: "var(--ctp-text)",
    outline: "none",
  };

  return (
    <div
      data-testid="rewrite-panel"
      style={{
        padding: "8px 12px",
        "border-top": "1px solid var(--ctp-surface0)",
        background: "var(--ctp-mantle)",
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
        Request Rewrite
      </div>

      <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", "align-items": "center" }}>
        {/* Model Override */}
        <label style={{ "font-size": "10px", color: "var(--ctp-subtext0)" }}>
          Model:
          <select
            data-testid="rewrite-model"
            value={modelOverride()}
            onChange={(e) => { setModelOverride(e.currentTarget.value); void saveConfig(); }}
            style={inputStyle}
          >
            <option value="">Default</option>
            <option value="claude-opus-4-6">Opus 4.6</option>
            <option value="claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
          </select>
        </label>

        {/* Temperature */}
        <label style={{ "font-size": "10px", color: "var(--ctp-subtext0)" }}>
          Temp:
          <input
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={temperature() ?? ""}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setTemperature(v ? parseFloat(v) : null);
            }}
            onBlur={() => void saveConfig()}
            style={{ ...inputStyle, width: "50px" }}
          />
        </label>

        {/* Max Tokens */}
        <label style={{ "font-size": "10px", color: "var(--ctp-subtext0)" }}>
          Max:
          <input
            type="number"
            min="1"
            step="1024"
            value={maxTokens() ?? ""}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setMaxTokens(v ? parseInt(v, 10) : null);
            }}
            onBlur={() => void saveConfig()}
            style={{ ...inputStyle, width: "70px" }}
          />
        </label>

        {/* Thinking Type */}
        <Show when={modelOverride().includes("opus") || modelOverride().includes("sonnet") || !modelOverride()}>
          <label style={{ "font-size": "10px", color: "var(--ctp-subtext0)" }}>
            Think:
            <select
              value={thinkingType()}
              onChange={(e) => { setThinkingType(e.currentTarget.value); void saveConfig(); }}
              style={inputStyle}
            >
              <option value="">Default</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </Show>

        {/* Pure Mode */}
        <label
          style={{
            display: "flex",
            "align-items": "center",
            gap: "3px",
            "font-size": "10px",
            color: pureMode() ? "var(--ctp-green)" : "var(--ctp-overlay0)",
            cursor: "pointer",
          }}
        >
          <input
            data-testid="rewrite-pure"
            type="checkbox"
            checked={pureMode()}
            onChange={() => { setPureMode(!pureMode()); void saveConfig(); }}
            style={{ width: "12px", height: "12px" }}
          />
          Pure
        </label>
      </div>
    </div>
  );
}
