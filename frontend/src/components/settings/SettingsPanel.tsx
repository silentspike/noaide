import { createSignal, onMount, For } from "solid-js";

interface Settings {
  theme: string;
  serverUrl: string;
  enableProfiler: boolean;
  enableAudio: boolean;
  enableWasmParser: boolean;
  panelSizes: { left: number; right: number };
}

const defaults: Settings = {
  theme: "catppuccin-mocha",
  serverUrl: "",
  enableProfiler: false,
  enableAudio: false,
  enableWasmParser: true,
  panelSizes: { left: 250, right: 350 },
};

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem("noaide-settings");
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
  } catch {
    return defaults;
  }
}

function saveSettings(settings: Settings) {
  localStorage.setItem("noaide-settings", JSON.stringify(settings));
}

export default function SettingsPanel() {
  const [settings, setSettings] = createSignal<Settings>(defaults);

  onMount(() => setSettings(loadSettings()));

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...settings(), [key]: value };
    setSettings(next);
    saveSettings(next);
  };

  const toggleStyle = (active: boolean) => ({
    width: "36px",
    height: "20px",
    "border-radius": "10px",
    background: active ? "var(--ctp-green)" : "var(--ctp-surface2)",
    position: "relative" as const,
    cursor: "pointer",
    transition: "background 0.2s",
  });

  const dotStyle = (active: boolean) => ({
    width: "16px",
    height: "16px",
    "border-radius": "50%",
    background: "var(--ctp-text)",
    position: "absolute" as const,
    top: "2px",
    left: active ? "18px" : "2px",
    transition: "left 0.2s",
  });

  return (
    <div
      style={{
        padding: "16px",
        color: "var(--ctp-text)",
        overflow: "auto",
        height: "100%",
      }}
    >
      <h3
        style={{
          margin: "0 0 16px 0",
          "font-size": "14px",
          color: "var(--ctp-mauve)",
        }}
      >
        Settings
      </h3>

      <section style={{ "margin-bottom": "20px" }}>
        <label
          style={{
            "font-size": "12px",
            color: "var(--ctp-subtext0)",
            display: "block",
            "margin-bottom": "6px",
          }}
        >
          Theme
        </label>
        <select
          value={settings().theme}
          onChange={(e) => update("theme", e.currentTarget.value)}
          style={{
            width: "100%",
            padding: "6px 8px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface2)",
            "border-radius": "4px",
            color: "var(--ctp-text)",
            "font-size": "12px",
          }}
        >
          <option value="catppuccin-mocha">Catppuccin Mocha</option>
        </select>
      </section>

      <section style={{ "margin-bottom": "20px" }}>
        <label
          style={{
            "font-size": "12px",
            color: "var(--ctp-subtext0)",
            display: "block",
            "margin-bottom": "6px",
          }}
        >
          WebTransport Server URL
        </label>
        <input
          value={settings().serverUrl}
          onInput={(e) => update("serverUrl", e.currentTarget.value)}
          placeholder="https://localhost:4433"
          style={{
            width: "100%",
            padding: "6px 8px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface2)",
            "border-radius": "4px",
            color: "var(--ctp-text)",
            "font-size": "12px",
          }}
        />
      </section>

      <h4
        style={{
          "font-size": "12px",
          color: "var(--ctp-subtext0)",
          "margin-bottom": "12px",
        }}
      >
        Feature Flags
      </h4>

      <For
        each={[
          { key: "enableProfiler" as const, label: "Performance Profiler" },
          { key: "enableAudio" as const, label: "UI Sounds" },
          { key: "enableWasmParser" as const, label: "WASM Parser" },
        ]}
      >
        {(flag) => (
          <div
            style={{
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
              "margin-bottom": "12px",
            }}
          >
            <span style={{ "font-size": "13px" }}>{flag.label}</span>
            <div
              style={toggleStyle(settings()[flag.key] as boolean)}
              onClick={() => update(flag.key, !settings()[flag.key])}
            >
              <div style={dotStyle(settings()[flag.key] as boolean)} />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
