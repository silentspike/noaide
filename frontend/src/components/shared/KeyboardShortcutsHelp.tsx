import { createSignal, onMount, onCleanup, Show, For } from "solid-js";

interface Shortcut {
  keys: string;
  action: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: "?", action: "Show keyboard shortcuts" },
  { keys: "Ctrl+K", action: "Command palette" },
  { keys: "Ctrl+Z", action: "Undo last plan edit" },
  { keys: "Ctrl+Shift+Z", action: "Redo plan edit" },
  { keys: "Ctrl+S", action: "Save file in editor" },
  { keys: "1-9", action: "Switch panel tab" },
  { keys: "Ctrl+Enter", action: "Send message" },
  { keys: "Escape", action: "Close modal / deselect" },
  { keys: "F11", action: "Toggle fullscreen" },
];

export default function KeyboardShortcutsHelp() {
  const [visible, setVisible] = createSignal(false);

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !(e.target as HTMLElement).matches("input, textarea, [contenteditable]")) {
      e.preventDefault();
      setVisible((v) => !v);
    }
    if (e.key === "Escape" && visible()) {
      setVisible(false);
    }
  };

  onMount(() => document.addEventListener("keydown", handleKey));
  onCleanup(() => document.removeEventListener("keydown", handleKey));

  return (
    <Show when={visible()}>
      <div
        data-testid="keyboard-shortcuts-overlay"
        style={{
          position: "fixed",
          inset: "0",
          "z-index": "10000",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          background: "rgba(0,0,0,0.6)",
          "backdrop-filter": "blur(4px)",
        }}
        onClick={(e) => { if (e.target === e.currentTarget) setVisible(false); }}
      >
        <div style={{
          background: "var(--ctp-base)",
          border: "1px solid var(--ctp-surface1)",
          "border-radius": "12px",
          padding: "24px",
          "min-width": "340px",
          "max-width": "420px",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <h3 style={{ margin: "0 0 16px", "font-size": "14px", color: "var(--ctp-text)", "font-family": "var(--font-mono)" }}>
            Keyboard Shortcuts
          </h3>
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <For each={SHORTCUTS}>
              {(s) => (
                <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                  <span style={{ "font-size": "12px", color: "var(--ctp-subtext0)" }}>{s.action}</span>
                  <kbd style={{
                    padding: "2px 8px",
                    background: "var(--ctp-surface0)",
                    border: "1px solid var(--ctp-surface2)",
                    "border-radius": "4px",
                    "font-size": "11px",
                    "font-family": "var(--font-mono)",
                    color: "var(--ctp-text)",
                    "white-space": "nowrap",
                  }}>
                    {s.keys}
                  </kbd>
                </div>
              )}
            </For>
          </div>
          <div style={{ "margin-top": "16px", "text-align": "center" }}>
            <span style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>Press ? or Escape to close</span>
          </div>
        </div>
      </div>
    </Show>
  );
}
