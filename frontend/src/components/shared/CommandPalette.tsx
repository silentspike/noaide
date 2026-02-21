import { createSignal, createEffect, For, Show, onMount } from "solid-js";

interface CommandItem {
  id: string;
  label: string;
  category: string;
  action: () => void;
  shortcut?: string;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}) {
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const filtered = () => {
    const q = query();
    if (!q) return props.items.slice(0, 20);
    return props.items.filter((item) => fuzzyMatch(q, item.label)).slice(0, 20);
  };

  createEffect(() => {
    if (props.open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef?.focus(), 0);
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = filtered();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selectedIndex()];
      if (item) {
        props.onClose();
        item.action();
      }
    } else if (e.key === "Escape") {
      props.onClose();
    }
  };

  return (
    <Show when={props.open}>
      <div
        style={{
          position: "fixed",
          inset: "0",
          "z-index": "1000",
          display: "flex",
          "justify-content": "center",
          "padding-top": "20vh",
          background: "rgba(0, 0, 0, 0.5)",
          "backdrop-filter": "blur(4px)",
        }}
        onClick={props.onClose}
      >
        <div
          style={{
            width: "500px",
            "max-height": "400px",
            background: "var(--ctp-surface0)",
            "border-radius": "12px",
            border: "1px solid var(--ctp-surface1)",
            overflow: "hidden",
            "box-shadow": "0 16px 48px rgba(0, 0, 0, 0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: "12px", "border-bottom": "1px solid var(--ctp-surface1)" }}>
            <input
              ref={inputRef}
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a command..."
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "var(--ctp-base)",
                border: "1px solid var(--ctp-surface2)",
                "border-radius": "6px",
                color: "var(--ctp-text)",
                "font-size": "14px",
                outline: "none",
              }}
            />
          </div>
          <div style={{ "max-height": "320px", overflow: "auto" }}>
            <For each={filtered()}>
              {(item, index) => (
                <div
                  style={{
                    padding: "8px 16px",
                    display: "flex",
                    "justify-content": "space-between",
                    "align-items": "center",
                    cursor: "pointer",
                    background:
                      index() === selectedIndex()
                        ? "var(--ctp-surface1)"
                        : "transparent",
                    color: "var(--ctp-text)",
                  }}
                  onMouseEnter={() => setSelectedIndex(index())}
                  onClick={() => {
                    props.onClose();
                    item.action();
                  }}
                >
                  <div>
                    <span style={{ "font-size": "13px" }}>{item.label}</span>
                    <span
                      style={{
                        "font-size": "11px",
                        color: "var(--ctp-overlay0)",
                        "margin-left": "8px",
                      }}
                    >
                      {item.category}
                    </span>
                  </div>
                  <Show when={item.shortcut}>
                    <span
                      style={{
                        "font-size": "11px",
                        color: "var(--ctp-overlay1)",
                        padding: "2px 6px",
                        background: "var(--ctp-surface2)",
                        "border-radius": "4px",
                        "font-family": "monospace",
                      }}
                    >
                      {item.shortcut}
                    </span>
                  </Show>
                </div>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <div
                style={{
                  padding: "24px",
                  "text-align": "center",
                  color: "var(--ctp-overlay0)",
                  "font-size": "13px",
                }}
              >
                No matching commands
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
