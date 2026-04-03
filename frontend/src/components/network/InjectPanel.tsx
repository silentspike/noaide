import { createSignal, For, onMount } from "solid-js";
import { useSession } from "../../App";

const PRESETS = [
  { id: "noaide_context", label: "noaide Context" },
  { id: "anti_laziness", label: "Anti-Laziness" },
  { id: "verify_evidence", label: "Verify Evidence" },
  { id: "speed", label: "Speed" },
  { id: "verbose", label: "Verbose" },
  { id: "german_only", label: "German Only" },
] as const;

export default function InjectPanel() {
  const store = useSession();
  const [activePresets, setActivePresets] = createSignal<string[]>(["noaide_context"]);
  const [customText, setCustomText] = createSignal("");

  async function fetchConfig() {
    const base = store.state.httpApiUrl;
    const sid = store.state.activeSessionId;
    if (!base || !sid) return;
    try {
      const res = await fetch(`${base}/api/proxy/inject/${sid}`);
      if (res.ok) {
        const data = await res.json();
        setActivePresets(data.presets || ["noaide_context"]);
        setCustomText(data.custom_text || "");
      }
    } catch { /* ignore */ }
  }

  async function saveConfig() {
    const base = store.state.httpApiUrl;
    const sid = store.state.activeSessionId;
    if (!base || !sid) return;
    try {
      await fetch(`${base}/api/proxy/inject/${sid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presets: activePresets(),
          custom_text: customText() || null,
        }),
      });
    } catch { /* ignore */ }
  }

  function togglePreset(presetId: string) {
    const current = activePresets();
    if (current.includes(presetId)) {
      setActivePresets(current.filter((p) => p !== presetId));
    } else {
      setActivePresets([...current, presetId]);
    }
    void saveConfig();
  }

  onMount(() => {
    void fetchConfig();
  });

  return (
    <div
      data-testid="inject-panel"
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
        System Prompt Injection
      </div>

      {/* Preset checkboxes */}
      <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap", "margin-bottom": "6px" }}>
        <For each={PRESETS}>
          {(preset) => (
            <label
              style={{
                display: "flex",
                "align-items": "center",
                gap: "3px",
                "font-size": "10px",
                color: activePresets().includes(preset.id)
                  ? "var(--ctp-text)"
                  : "var(--ctp-overlay0)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={activePresets().includes(preset.id)}
                onChange={() => togglePreset(preset.id)}
                style={{ width: "12px", height: "12px" }}
              />
              {preset.label}
            </label>
          )}
        </For>
      </div>

      {/* Custom text */}
      <textarea
        data-testid="inject-custom-text"
        placeholder="Custom injection text..."
        value={customText()}
        onInput={(e) => setCustomText(e.currentTarget.value)}
        onBlur={() => void saveConfig()}
        style={{
          width: "100%",
          "min-height": "40px",
          padding: "4px 6px",
          "font-size": "10px",
          "font-family": "var(--font-mono)",
          background: "var(--ctp-surface0)",
          border: "1px solid var(--ctp-surface1)",
          "border-radius": "3px",
          color: "var(--ctp-text)",
          resize: "vertical",
          outline: "none",
        }}
      />
    </div>
  );
}
