import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { useSession } from "../../App";

type PresetMeta = {
  id: string;
  label: string;
  description: string;
  accent: string;
  badge?: string;
};

const DEFAULT_PRESETS = ["noaide_context"];

const PRESETS: PresetMeta[] = [
  {
    id: "anti_laziness",
    label: "Anti-Laziness",
    description: "Forces complete work and rejects placeholder snippets or partial file dumps.",
    accent: "var(--ctp-peach)",
    badge: "Strict",
  },
  {
    id: "verify_evidence",
    label: "Verify Evidence",
    description: "Requires command output, file contents, measurements, or other concrete proof.",
    accent: "var(--ctp-blue)",
    badge: "Traceable",
  },
  {
    id: "speed",
    label: "Speed",
    description: "Biases toward concise answers, minimal framing, and fast execution.",
    accent: "var(--ctp-green)",
    badge: "Lean",
  },
  {
    id: "verbose",
    label: "Verbose",
    description: "Asks for fuller explanations, more context, and explicit tradeoff coverage.",
    accent: "var(--ctp-mauve)",
    badge: "Detailed",
  },
  {
    id: "german_only",
    label: "German Only",
    description: "Keeps the agent's communication in German while leaving code identifiers intact.",
    accent: "var(--ctp-yellow)",
    badge: "Locale",
  },
  {
    id: "noaide_context",
    label: "noaide Context",
    description: "Adds the IDE-specific media and rendering context that noaide supports.",
    accent: "var(--ctp-teal)",
    badge: "Default",
  },
] as const;

type SaveState = "idle" | "saving" | "saved" | "error";

type RewriteConfigPayload = {
  model_override?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  thinking_type?: string | null;
  pure_mode?: boolean;
  strip_system_prompt?: boolean;
  strip_tools?: boolean;
};

type SpeedRewriteDefaults = {
  model_override: string;
  temperature: number;
  max_tokens: number;
};

export default function InjectPanel() {
  const store = useSession();
  const [activePresets, setActivePresets] = createSignal<string[]>(DEFAULT_PRESETS);
  const [customText, setCustomText] = createSignal("");
  const [saveState, setSaveState] = createSignal<SaveState>("idle");

  let fetchGeneration = 0;
  let saveGeneration = 0;
  let saveStateTimer: number | undefined;

  onCleanup(() => {
    if (saveStateTimer) {
      window.clearTimeout(saveStateTimer);
    }
  });

  function scheduleSaveStateReset() {
    if (saveStateTimer) {
      window.clearTimeout(saveStateTimer);
    }
    saveStateTimer = window.setTimeout(() => {
      setSaveState("idle");
    }, 1400);
  }

  function resetLocalState(nextSaveState: SaveState = "idle") {
    setActivePresets(DEFAULT_PRESETS);
    setCustomText("");
    setSaveState(nextSaveState);
  }

  async function fetchConfig(base: string, sid: string) {
    const currentFetch = ++fetchGeneration;
    try {
      const res = await fetch(`${base}/api/proxy/inject/${sid}`);
      if (!res.ok) {
        if (currentFetch !== fetchGeneration) return;
        resetLocalState(res.status === 404 ? "idle" : "error");
        if (res.status !== 404) {
          scheduleSaveStateReset();
        }
        return;
      }
      const data = await res.json() as { presets?: string[]; custom_text?: string | null };
      if (currentFetch !== fetchGeneration) return;
      setActivePresets(
        Array.isArray(data.presets) && data.presets.length > 0
          ? data.presets
          : DEFAULT_PRESETS,
      );
      setCustomText(data.custom_text || "");
      setSaveState("idle");
    } catch {
      if (currentFetch !== fetchGeneration) return;
      resetLocalState("error");
      scheduleSaveStateReset();
    }
  }

  async function saveConfig(next: { presets?: string[]; customText?: string } = {}) {
    const base = store.state.httpApiUrl;
    const sid = store.state.activeSessionId;
    if (!base || !sid) return;

    const presets = next.presets ?? activePresets();
    const text = next.customText ?? customText();
    const currentSave = ++saveGeneration;

    setSaveState("saving");

    try {
      const res = await fetch(`${base}/api/proxy/inject/${sid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presets,
          custom_text: text || null,
        }),
      });
      if (currentSave !== saveGeneration) return;
      if (!res.ok) {
        setSaveState("error");
        scheduleSaveStateReset();
        return;
      }
      setSaveState("saved");
      scheduleSaveStateReset();
    } catch {
      if (currentSave !== saveGeneration) return;
      setSaveState("error");
      scheduleSaveStateReset();
    }
  }

  function speedRewriteDefaults(): SpeedRewriteDefaults {
    switch (store.activeSession()?.cliType) {
      case "codex":
        return { model_override: "gpt-4o", temperature: 0, max_tokens: 1024 };
      case "gemini":
        return { model_override: "gemini-2.5-flash", temperature: 0, max_tokens: 1024 };
      case "claude":
      default:
        return { model_override: "claude-haiku-4-5-20251001", temperature: 0, max_tokens: 1024 };
    }
  }

  async function syncSpeedRewritePreset(enabled: boolean) {
    const base = store.state.httpApiUrl;
    const sid = store.state.activeSessionId;
    if (!base || !sid) return;

    const defaults = speedRewriteDefaults();
    let current: RewriteConfigPayload = {};
    try {
      const res = await fetch(base + "/api/proxy/rewrite/" + sid);
      if (res.ok) {
        current = await res.json() as RewriteConfigPayload;
      }

      const next: RewriteConfigPayload = { ...current };
      if (enabled) {
        next.model_override = defaults.model_override;
        next.temperature = defaults.temperature;
        next.max_tokens = defaults.max_tokens;
      } else {
        if (next.model_override === defaults.model_override) next.model_override = null;
        if (next.temperature === defaults.temperature) next.temperature = null;
        if (next.max_tokens === defaults.max_tokens) next.max_tokens = null;
      }

      const put = await fetch(base + "/api/proxy/rewrite/" + sid, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (put.ok) {
        window.dispatchEvent(new CustomEvent("noaide:rewrite-config-updated", { detail: { sessionId: sid } }));
      }
    } catch {
      /* keep inject save independent from rewrite sync */
    }
  }

  createEffect(
    on(
      () => [
        store.state.httpApiUrl,
        store.state.activeSessionId,
        store.state.connectionStatus,
      ] as const,
      ([base, sid, connectionStatus], previous) => {
        const [previousBase, previousSid, previousConnectionStatus] = previous ?? [];
        const scopeChanged = base !== previousBase || sid !== previousSid;
        const reconnected =
          previousConnectionStatus !== "connected" && connectionStatus === "connected";

        if (!base || !sid) {
          fetchGeneration++;
          saveGeneration++;
          resetLocalState();
          return;
        }

        if (!scopeChanged && !reconnected) {
          return;
        }

        saveGeneration++;
        void fetchConfig(base, sid);
      },
    ),
  );

  const activePresetMeta = createMemo(() =>
    PRESETS.filter((preset) => activePresets().includes(preset.id)),
  );

  const customInstructionCount = createMemo(() => {
    const trimmed = customText().trim();
    return trimmed ? trimmed.length : 0;
  });

  const summaryText = createMemo(() => {
    const presetCount = activePresetMeta().length;
    const customCount = customInstructionCount() > 0 ? 1 : 0;
    const total = presetCount + customCount;
    if (total === 0) return "No active injection rules";
    if (customCount === 0) return `${presetCount} preset${presetCount === 1 ? "" : "s"} active`;
    return `${presetCount} preset${presetCount === 1 ? "" : "s"} + custom text`;
  });

  function togglePreset(presetId: string) {
    const current = activePresets();
    const willEnable = !current.includes(presetId);
    const nextPresets = willEnable
      ? [...current, presetId]
      : current.filter((preset) => preset !== presetId);

    setActivePresets(nextPresets);
    void saveConfig({ presets: nextPresets });
    if (presetId === "speed") {
      void syncSpeedRewritePreset(willEnable);
    }
  }

  function resetToDefault() {
    const speedWasActive = activePresets().includes("speed");
    setActivePresets(DEFAULT_PRESETS);
    setCustomText("");
    void saveConfig({ presets: DEFAULT_PRESETS, customText: "" });
    if (speedWasActive) {
      void syncSpeedRewritePreset(false);
    }
  }

  const statusColor = () => {
    switch (saveState()) {
      case "saved":
        return "var(--ctp-green)";
      case "saving":
        return "var(--ctp-yellow)";
      case "error":
        return "var(--ctp-red)";
      default:
        return "var(--ctp-overlay0)";
    }
  };

  const statusLabel = () => {
    switch (saveState()) {
      case "saved":
        return "Saved";
      case "saving":
        return "Saving...";
      case "error":
        return "Sync error";
      default:
        return "Session scoped";
    }
  };

  return (
    <section data-testid="inject-section">
      <div
        data-testid="inject-panel"
      style={{
        padding: "10px 12px 12px",
        "border-top": "1px solid var(--ctp-surface0)",
        background: "var(--ctp-mantle)",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "flex-start",
          "justify-content": "space-between",
          gap: "12px",
          "margin-bottom": "10px",
        }}
      >
        <div>
          <div
            style={{
              "font-size": "11px",
              "font-weight": "700",
              color: "var(--ctp-text)",
              "letter-spacing": "0.02em",
            }}
          >
            System Prompt Injection
          </div>
          <div
            style={{
              "font-size": "10px",
              color: "var(--ctp-subtext0)",
              "margin-top": "2px",
              "max-width": "480px",
              "line-height": "1.45",
            }}
          >
            Shape the session's upstream system prompt before the next model request. Anti-Laziness
            is surfaced first because it is the strictest completeness guard.
          </div>
        </div>

        <div
          data-testid="inject-save-state"
          style={{
            "font-size": "9px",
            "font-weight": "700",
            color: statusColor(),
            padding: "4px 8px",
            "border-radius": "999px",
            border: `1px solid color-mix(in srgb, ${statusColor()} 35%, transparent)`,
            background: `color-mix(in srgb, ${statusColor()} 14%, transparent)`,
            "white-space": "nowrap",
          }}
        >
          {statusLabel()}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: "8px",
          "grid-template-columns": "repeat(auto-fit, minmax(170px, 1fr))",
          "margin-bottom": "10px",
        }}
      >
        <For each={PRESETS}>
          {(preset) => {
            const isActive = () => activePresets().includes(preset.id);
            return (
              <button
                type="button"
                data-testid={`inject-preset-${preset.id}`}
                aria-pressed={isActive()}
                onClick={() => togglePreset(preset.id)}
                style={{
                  display: "flex",
                  "flex-direction": "column",
                  gap: "8px",
                  padding: "10px",
                  "text-align": "left",
                  border: `1px solid ${isActive() ? preset.accent : "var(--ctp-surface1)"}`,
                  "border-radius": "8px",
                  background: isActive()
                    ? `linear-gradient(180deg, color-mix(in srgb, ${preset.accent} 16%, var(--ctp-surface0)), color-mix(in srgb, ${preset.accent} 7%, var(--ctp-mantle)))`
                    : "linear-gradient(180deg, var(--ctp-surface0), color-mix(in srgb, var(--ctp-surface0) 55%, var(--ctp-mantle)))",
                  color: "var(--ctp-text)",
                  cursor: "pointer",
                  "box-shadow": isActive() ? `0 0 0 1px color-mix(in srgb, ${preset.accent} 18%, transparent)` : "none",
                  transition: "border-color 120ms ease, background 120ms ease, box-shadow 120ms ease",
                  "min-height": "112px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "6px",
                      "flex-wrap": "wrap",
                    }}
                  >
                    <span
                      style={{
                        "font-size": "11px",
                        "font-weight": "700",
                      }}
                    >
                      {preset.label}
                    </span>
                    <Show when={preset.badge}>
                      <span
                        style={{
                          "font-size": "8px",
                          "font-weight": "700",
                          "letter-spacing": "0.05em",
                          "text-transform": "uppercase",
                          color: preset.accent,
                          padding: "2px 5px",
                          "border-radius": "999px",
                          background: `color-mix(in srgb, ${preset.accent} 18%, transparent)`,
                        }}
                      >
                        {preset.badge}
                      </span>
                    </Show>
                  </div>

                  <span
                    aria-hidden="true"
                    style={{
                      width: "18px",
                      height: "18px",
                      display: "inline-flex",
                      "align-items": "center",
                      "justify-content": "center",
                      "border-radius": "999px",
                      background: isActive()
                        ? preset.accent
                        : "color-mix(in srgb, var(--ctp-surface2) 50%, transparent)",
                      color: isActive() ? "var(--ctp-base)" : "var(--ctp-overlay0)",
                      "font-size": "11px",
                      "font-weight": "700",
                    }}
                  >
                    {isActive() ? "✓" : "+"}
                  </span>
                </div>

                <div
                  style={{
                    "font-size": "10px",
                    color: isActive() ? "var(--ctp-text)" : "var(--ctp-subtext0)",
                    "line-height": "1.45",
                  }}
                >
                  {preset.description}
                </div>
              </button>
            );
          }}
        </For>
      </div>

      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          gap: "8px",
          "margin-bottom": "8px",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-wrap": "wrap" }}>
          <span
            style={{
              "font-size": "9px",
              "font-weight": "700",
              color: "var(--ctp-overlay0)",
              "text-transform": "uppercase",
              "letter-spacing": "0.05em",
            }}
          >
            Prompt Blend
          </span>
          <span
            data-testid="inject-summary"
            style={{ "font-size": "10px", color: "var(--ctp-subtext0)" }}
          >
            {summaryText()}
          </span>
        </div>

        <button
          type="button"
          data-testid="inject-reset-defaults"
          onClick={resetToDefault}
          style={{
            padding: "4px 8px",
            "font-size": "9px",
            "font-weight": "700",
            color: "var(--ctp-subtext0)",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "999px",
            cursor: "pointer",
            "white-space": "nowrap",
          }}
        >
          Reset defaults
        </button>
      </div>

      <Show when={activePresetMeta().length > 0}>
        <div
          style={{
            display: "flex",
            gap: "6px",
            "flex-wrap": "wrap",
            "margin-bottom": "10px",
          }}
        >
          <For each={activePresetMeta()}>
            {(preset) => (
              <span
                style={{
                  "font-size": "9px",
                  "font-weight": "700",
                  color: preset.accent,
                  padding: "3px 7px",
                  "border-radius": "999px",
                  background: `color-mix(in srgb, ${preset.accent} 16%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${preset.accent} 30%, transparent)`,
                }}
              >
                {preset.label}
              </span>
            )}
          </For>
        </div>
      </Show>

      <label
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "6px",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "8px",
          }}
        >
          <span
            style={{
              "font-size": "10px",
              "font-weight": "600",
              color: "var(--ctp-text)",
            }}
          >
            Custom instructions
          </span>
          <span
            style={{
              "font-size": "9px",
              color: "var(--ctp-overlay0)",
            }}
          >
            {customInstructionCount() > 0
              ? `${customInstructionCount()} chars`
              : "Appended after presets"}
          </span>
        </div>

        <textarea
          data-testid="inject-custom-text"
          placeholder="Add session-specific system instructions..."
          value={customText()}
          onInput={(e) => setCustomText(e.currentTarget.value)}
          onBlur={() => void saveConfig({ customText: customText() })}
          style={{
            width: "100%",
            "min-height": "72px",
            padding: "8px 10px",
            "font-size": "10px",
            "line-height": "1.5",
            "font-family": "var(--font-mono)",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "8px",
            color: "var(--ctp-text)",
            resize: "vertical",
            outline: "none",
          }}
        />
      </label>
      </div>
    </section>
  );
}
