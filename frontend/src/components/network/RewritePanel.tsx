import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useSession } from "../../App";

type RewriteModelOption = {
  value: string;
  label: string;
};

const CLAUDE_MODEL_OPTIONS: RewriteModelOption[] = [
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

const CODEX_MODEL_OPTIONS: RewriteModelOption[] = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { value: "gpt-4o", label: "GPT-4o" },
];

const GEMINI_MODEL_OPTIONS: RewriteModelOption[] = [
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
];

function modelOptionsFor(cliType?: "claude" | "codex" | "gemini"): RewriteModelOption[] {
  switch (cliType) {
    case "codex":
      return CODEX_MODEL_OPTIONS;
    case "gemini":
      return GEMINI_MODEL_OPTIONS;
    case "claude":
    default:
      return CLAUDE_MODEL_OPTIONS;
  }
}

export default function RewritePanel() {
  const store = useSession();
  const [modelOverride, setModelOverride] = createSignal("");
  const [temperature, setTemperature] = createSignal<number | null>(null);
  const [maxTokens, setMaxTokens] = createSignal<number | null>(null);
  const [thinkingType, setThinkingType] = createSignal("");
  const [pureMode, setPureMode] = createSignal(false);
  const [stripSystemPrompt, setStripSystemPrompt] = createSignal(false);
  const [stripTools, setStripTools] = createSignal(false);

  function resetLocalState() {
    setModelOverride("");
    setTemperature(null);
    setMaxTokens(null);
    setThinkingType("");
    setPureMode(false);
    setStripSystemPrompt(false);
    setStripTools(false);
  }

  async function fetchConfig() {
    const base = store.state.httpApiUrl;
    const sid = store.state.activeSessionId;
    if (!base || !sid) {
      resetLocalState();
      return;
    }
    try {
      const res = await fetch(`${base}/api/proxy/rewrite/${sid}`);
      if (res.ok) {
        const data = await res.json();
        setModelOverride(data.model_override || "");
        setTemperature(data.temperature ?? null);
        setMaxTokens(data.max_tokens ?? null);
        setThinkingType(data.thinking_type || "");
        setPureMode(data.pure_mode || false);
        setStripSystemPrompt(data.strip_system_prompt || false);
        setStripTools(data.strip_tools || false);
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
          strip_system_prompt: stripSystemPrompt(),
          strip_tools: stripTools(),
        }),
      });
    } catch { /* ignore */ }
  }

  async function resetConfig() {
    resetLocalState();
    await saveConfig();
  }

  createEffect(() => {
    void store.state.activeSessionId;
    void fetchConfig();
  });

  onMount(() => {
    const handler = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (!sessionId || sessionId === store.state.activeSessionId) {
        void fetchConfig();
      }
    };
    window.addEventListener("noaide:rewrite-config-updated", handler);
    onCleanup(() => window.removeEventListener("noaide:rewrite-config-updated", handler));
  });

  const activeCliType = () => store.activeSession()?.cliType ?? "claude";
  const showThinkingType = () => activeCliType() === "claude";
  const modelOptions = () => {
    const current = modelOverride();
    const options = modelOptionsFor(activeCliType());
    if (!current || options.some((option) => option.value === current)) {
      return options;
    }
    return [{ value: current, label: current }, ...options];
  };

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
    <section data-testid="rewrite-section">
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

      <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", "align-items": "center", "margin-bottom": "8px" }}>
        {/* Model Override */}
        <label style={{ "font-size": "10px", color: "var(--ctp-subtext0)" }}>
          Model:
          <select
            data-testid="model-select"
            value={modelOverride()}
            onChange={(e) => { setModelOverride(e.currentTarget.value); void saveConfig(); }}
            style={inputStyle}
          >
            <option value="">Default</option>
            <For each={modelOptions()}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </select>
        </label>

        {/* Temperature */}
        <label style={{ "font-size": "10px", color: "var(--ctp-subtext0)" }}>
          Temp:
          <input
            data-testid="temperature-input"
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
            data-testid="max-tokens-input"
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
        <Show when={showThinkingType()}>
          <label style={{ "font-size": "10px", color: "var(--ctp-subtext0)" }}>
            Think:
            <select
              data-testid="thinking-select"
              value={thinkingType()}
              onChange={(e) => { setThinkingType(e.currentTarget.value); void saveConfig(); }}
              style={inputStyle}
            >
              <option value="">Default</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="remove">Remove</option>
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

      <div style={{ display: "flex", gap: "10px", "flex-wrap": "wrap", "align-items": "center" }}>
        <label
          style={{
            display: "flex",
            "align-items": "center",
            gap: "4px",
            "font-size": "10px",
            color: stripSystemPrompt() ? "var(--ctp-peach)" : "var(--ctp-overlay0)",
            cursor: "pointer",
          }}
        >
          <input
            data-testid="strip-system-prompt"
            type="checkbox"
            checked={stripSystemPrompt()}
            onChange={() => {
              setStripSystemPrompt(!stripSystemPrompt());
              void saveConfig();
            }}
            style={{ width: "12px", height: "12px" }}
          />
          Strip system
        </label>

        <label
          style={{
            display: "flex",
            "align-items": "center",
            gap: "4px",
            "font-size": "10px",
            color: stripTools() ? "var(--ctp-yellow)" : "var(--ctp-overlay0)",
            cursor: "pointer",
          }}
        >
          <input
            data-testid="strip-tools"
            type="checkbox"
            checked={stripTools()}
            onChange={() => {
              setStripTools(!stripTools());
              void saveConfig();
            }}
            style={{ width: "12px", height: "12px" }}
          />
          Strip tools
        </label>

        <button
          type="button"
          data-testid="rewrite-reset"
          onClick={() => void resetConfig()}
          style={{
            padding: "3px 8px",
            "font-size": "10px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "4px",
            color: "var(--ctp-subtext0)",
            cursor: "pointer",
            "font-weight": "600",
          }}
        >
          Reset
        </button>
      </div>
      </div>
    </section>
  );
}
