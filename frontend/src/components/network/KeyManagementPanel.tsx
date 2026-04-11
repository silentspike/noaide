import { createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { useSession } from "../../App";

interface ApiKeyRecord {
  id: string;
  provider: string;
  label: string;
  masked_value: string;
  active: boolean;
  rate_limit_5h: number;
  rate_limit_7d: number;
  request_count: number;
}

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "google", label: "Google" },
  { value: "google-codeassist", label: "Google Code Assist" },
];

export default function KeyManagementPanel() {
  const store = useSession();
  const [expanded, setExpanded] = createSignal(false);
  const [keys, setKeys] = createSignal<ApiKeyRecord[]>([]);
  const [provider, setProvider] = createSignal("anthropic");
  const [label, setLabel] = createSignal("");
  const [keyValue, setKeyValue] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  async function fetchKeys() {
    const base = store.state.httpApiUrl;
    if (!base) return;
    try {
      const res = await fetch(`${base}/api/proxy/keys`);
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch { /* ignore */ }
  }

  async function saveKey() {
    const base = store.state.httpApiUrl;
    if (!base || !label().trim() || !keyValue().trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${base}/api/proxy/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider(),
          label: label().trim(),
          key: keyValue().trim(),
        }),
      });
      if (res.ok) {
        setLabel("");
        setKeyValue("");
        await fetchKeys();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function updateKeyActive(id: string, active: boolean) {
    const base = store.state.httpApiUrl;
    if (!base) return;
    try {
      const res = await fetch(`${base}/api/proxy/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (res.ok) {
        await fetchKeys();
      }
    } catch { /* ignore */ }
  }

  async function deleteKey(id: string) {
    const base = store.state.httpApiUrl;
    if (!base) return;
    try {
      const res = await fetch(`${base}/api/proxy/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchKeys();
      }
    } catch { /* ignore */ }
  }

  onMount(() => {
    void fetchKeys();
    const interval = setInterval(() => { void fetchKeys(); }, 5000);
    onCleanup(() => clearInterval(interval));
  });

  return (
    <div
      style={{
        padding: "8px 12px",
        "border-top": "1px solid var(--ctp-surface0)",
        background: "var(--ctp-mantle)",
      }}
    >
      <button
        data-testid="keys-section"
        onClick={() => setExpanded((v) => !v)}
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
        <span>API Keys</span>
        <span style={{ "font-size": "9px", color: "var(--ctp-overlay0)" }}>
          {keys().length} configured
        </span>
      </button>

      <Show when={expanded()}>
        <div style={{ display: "grid", gap: "8px", "margin-top": "8px" }}>
          <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", gap: "8px" }}>
            <div style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>
              Keys stay masked in the UI; only provider + preview are shown.
            </div>
            <button
              data-testid="add-key-btn"
              onClick={() => {
                setLabel("Test Key");
                setProvider("anthropic");
              }}
              style={{
                padding: "4px 8px",
                "font-size": "9px",
                "font-weight": "700",
                color: "var(--ctp-base)",
                background: "var(--ctp-blue)",
                border: "none",
                "border-radius": "999px",
                cursor: "pointer",
              }}
            >
              Add key
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gap: "8px",
              "grid-template-columns": "repeat(auto-fit, minmax(140px, 1fr))",
            }}
          >
            <label style={{ display: "grid", gap: "4px" }}>
              <span style={{ "font-size": "9px", color: "var(--ctp-overlay0)" }}>Provider</span>
              <select
                value={provider()}
                onChange={(e) => setProvider(e.currentTarget.value)}
                style={{
                  padding: "6px 8px",
                  background: "var(--ctp-surface0)",
                  border: "1px solid var(--ctp-surface1)",
                  "border-radius": "6px",
                  color: "var(--ctp-text)",
                  "font-size": "10px",
                }}
              >
                <For each={PROVIDERS}>
                  {(item) => (
                    <option value={item.value}>{item.label}</option>
                  )}
                </For>
              </select>
            </label>

            <label style={{ display: "grid", gap: "4px" }}>
              <span style={{ "font-size": "9px", color: "var(--ctp-overlay0)" }}>Label</span>
              <input
                data-testid="key-label-input"
                value={label()}
                onInput={(e) => setLabel(e.currentTarget.value)}
                placeholder="Anthropic Primary"
                style={{
                  padding: "6px 8px",
                  background: "var(--ctp-surface0)",
                  border: "1px solid var(--ctp-surface1)",
                  "border-radius": "6px",
                  color: "var(--ctp-text)",
                  "font-size": "10px",
                }}
              />
            </label>

            <label style={{ display: "grid", gap: "4px", "grid-column": "1 / -1" }}>
              <span style={{ "font-size": "9px", color: "var(--ctp-overlay0)" }}>Key value</span>
              <input
                data-testid="key-value-input"
                value={keyValue()}
                onInput={(e) => setKeyValue(e.currentTarget.value)}
                placeholder="sk-ant-..."
                style={{
                  padding: "6px 8px",
                  background: "var(--ctp-surface0)",
                  border: "1px solid var(--ctp-surface1)",
                  "border-radius": "6px",
                  color: "var(--ctp-text)",
                  "font-size": "10px",
                  "font-family": "var(--font-mono)",
                }}
              />
            </label>
          </div>

          <div style={{ display: "flex", "justify-content": "flex-end" }}>
            <button
              data-testid="key-save-btn"
              onClick={() => void saveKey()}
              disabled={saving()}
              style={{
                padding: "5px 10px",
                "font-size": "9px",
                "font-weight": "700",
                color: "var(--ctp-base)",
                background: saving() ? "var(--ctp-surface1)" : "var(--neon-green, #00ff9d)",
                border: "none",
                "border-radius": "999px",
                cursor: saving() ? "default" : "pointer",
              }}
            >
              {saving() ? "Saving..." : "Save key"}
            </button>
          </div>

          <Show
            when={keys().length > 0}
            fallback={<div style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>No keys configured yet</div>}
          >
            <div style={{ display: "grid", gap: "6px" }}>
              <For each={keys()}>
                {(key) => (
                  <div
                    style={{
                      display: "grid",
                      gap: "6px",
                      padding: "8px 10px",
                      background: "var(--ctp-surface0)",
                      border: "1px solid var(--ctp-surface1)",
                      "border-radius": "8px",
                    }}
                  >
                    <div style={{ display: "flex", "justify-content": "space-between", gap: "8px", "align-items": "center" }}>
                      <div style={{ display: "grid", gap: "2px" }}>
                        <div style={{ "font-size": "10px", color: key.active ? "var(--ctp-text)" : "var(--ctp-overlay0)" }}>
                          {key.label} ({key.provider})
                        </div>
                        <div style={{ "font-size": "10px", color: "var(--ctp-overlay0)", "font-family": "var(--font-mono)" }}>
                          {key.masked_value}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
                        <button
                          data-testid={`key-toggle-${key.id}`}
                          onClick={() => void updateKeyActive(key.id, !key.active)}
                          style={{
                            padding: "4px 8px",
                            "font-size": "9px",
                            "font-weight": "700",
                            color: key.active ? "var(--ctp-base)" : "var(--ctp-text)",
                            background: key.active ? "var(--ctp-green)" : "var(--ctp-surface1)",
                            border: "none",
                            "border-radius": "999px",
                            cursor: "pointer",
                          }}
                        >
                          {key.active ? "Active" : "Inactive"}
                        </button>
                        <button
                          data-testid={`key-delete-${key.id}`}
                          onClick={() => void deleteKey(key.id)}
                          style={{
                            padding: "4px 8px",
                            "font-size": "9px",
                            "font-weight": "700",
                            color: "var(--ctp-base)",
                            background: "var(--ctp-red)",
                            border: "none",
                            "border-radius": "999px",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "12px", "font-size": "9px", color: "var(--ctp-overlay0)" }}>
                      <span>{key.request_count} reqs</span>
                      <span>5h {key.rate_limit_5h.toFixed(0)}%</span>
                      <span>7d {key.rate_limit_7d.toFixed(0)}%</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
