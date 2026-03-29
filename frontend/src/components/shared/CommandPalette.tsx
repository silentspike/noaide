import { createSignal, createEffect, createMemo, For, Show } from "solid-js";

export interface CommandItem {
  id: string;
  label: string;
  category: string;
  action: () => void;
  shortcut?: string;
  icon?: string;
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

function highlightMatch(query: string, text: string): { text: string; match: boolean }[] {
  if (!query) return [{ text, match: false }];
  const q = query.toLowerCase();
  const result: { text: string; match: boolean }[] = [];
  let qi = 0;
  let buf = "";
  let matching = false;

  for (let ti = 0; ti < text.length; ti++) {
    const isMatch = qi < q.length && text[ti].toLowerCase() === q[qi];
    if (isMatch !== matching && buf) {
      result.push({ text: buf, match: matching });
      buf = "";
    }
    buf += text[ti];
    matching = isMatch;
    if (isMatch) qi++;
  }
  if (buf) result.push({ text: buf, match: matching });
  return result;
}

// Scope prefixes — typed prefix filters results by category
const SCOPE_PREFIXES: Record<string, string> = {
  ">": "Commands",
  "#": "Sessions",
  "@": "Tabs",
  "?": "Help",
};

export default function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}) {
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  // Parse scope prefix from query
  const parsedQuery = createMemo(() => {
    const raw = query();
    const first = raw[0];
    if (first && SCOPE_PREFIXES[first]) {
      return { scope: SCOPE_PREFIXES[first], text: raw.slice(1) };
    }
    return { scope: null, text: raw };
  });

  const filtered = createMemo(() => {
    const { scope, text } = parsedQuery();
    let candidates = props.items;

    if (scope) {
      candidates = candidates.filter(
        (item) => item.category.toLowerCase() === scope.toLowerCase(),
      );
    }

    if (text) {
      candidates = candidates.filter((item) => fuzzyMatch(text, item.label));
    }

    return candidates.slice(0, 30);
  });

  // Group by category
  const grouped = createMemo(() => {
    const items = filtered();
    const groups: { category: string; items: CommandItem[] }[] = [];
    const seen = new Map<string, CommandItem[]>();

    for (const item of items) {
      let arr = seen.get(item.category);
      if (!arr) {
        arr = [];
        seen.set(item.category, arr);
        groups.push({ category: item.category, items: arr });
      }
      arr.push(item);
    }
    return groups;
  });

  // Flat list for keyboard navigation
  const flatItems = createMemo(() => grouped().flatMap((g) => g.items));

  createEffect(() => {
    if (props.open) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef?.focus());
    }
  });

  // Scroll selected item into view
  createEffect(() => {
    const idx = selectedIndex();
    if (!listRef) return;
    const el = listRef.querySelector(`[data-cmd-idx="${idx}"]`) as HTMLElement;
    if (el) el.scrollIntoView({ block: "nearest" });
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = flatItems();
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
    } else if (e.key === "Tab") {
      e.preventDefault();
      // Tab cycles through scope prefixes
      const prefixes = Object.keys(SCOPE_PREFIXES);
      const current = query()[0];
      const idx = prefixes.indexOf(current ?? "");
      const next = prefixes[(idx + 1) % prefixes.length];
      setQuery(next);
      setSelectedIndex(0);
    }
  };

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const modKey = isMac ? "\u2318" : "Ctrl+";

  // Flat index counter for keyboard navigation
  let flatIdx = 0;

  return (
    <Show when={props.open}>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: "0",
          "z-index": "9500",
          display: "flex",
          "justify-content": "center",
          "padding-top": "18vh",
          background: "rgba(0, 0, 0, 0.55)",
          "backdrop-filter": "blur(8px)",
          "-webkit-backdrop-filter": "blur(8px)",
          animation: "cmd-fade-in 120ms ease-out",
        }}
        onClick={() => props.onClose()}
      >
        {/* Panel */}
        <div
          style={{
            width: "min(560px, calc(100vw - 32px))",
            "max-height": "440px",
            background: "rgba(8, 8, 16, 0.92)",
            "backdrop-filter": "blur(24px)",
            "-webkit-backdrop-filter": "blur(24px)",
            "border-radius": "12px",
            border: "1px solid var(--ctp-surface1)",
            overflow: "hidden",
            "box-shadow": "0 0 0 1px rgba(0,184,255,0.06), 0 20px 60px rgba(0, 0, 0, 0.6)",
            "align-self": "flex-start",
            animation: "cmd-slide-in 150ms ease-out",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Input */}
          <div
            style={{
              padding: "12px 16px",
              "border-bottom": "1px solid var(--ctp-surface0)",
              display: "flex",
              "align-items": "center",
              gap: "8px",
            }}
          >
            {/* Scope indicator */}
            <Show when={parsedQuery().scope}>
              <span
                style={{
                  "font-size": "10px",
                  "font-weight": "700",
                  "font-family": "var(--font-mono)",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.08em",
                  padding: "2px 8px",
                  "border-radius": "4px",
                  "flex-shrink": "0",
                  background: "rgba(0,184,255,0.08)",
                  color: "var(--neon-blue, #00b8ff)",
                  border: "1px solid rgba(0,184,255,0.2)",
                }}
              >
                {parsedQuery().scope}
              </span>
            </Show>

            <input
              ref={inputRef}
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={parsedQuery().scope ? `Search ${parsedQuery().scope}...` : "Search commands... (> # @ ? for scope)"}
              style={{
                flex: "1",
                padding: "6px 0",
                background: "transparent",
                border: "none",
                color: "var(--ctp-text)",
                "font-size": "14px",
                "font-family": "var(--font-mono)",
                outline: "none",
              }}
            />

            {/* Shortcut hint */}
            <span
              style={{
                "font-size": "10px",
                color: "var(--ctp-overlay0)",
                "font-family": "var(--font-mono)",
                "flex-shrink": "0",
              }}
            >
              {modKey}K
            </span>
          </div>

          {/* Results */}
          <div ref={listRef} style={{ "max-height": "360px", overflow: "auto", padding: "4px 0" }}>
            {(() => {
              flatIdx = 0;
              return null;
            })()}
            <For each={grouped()}>
              {(group) => (
                <>
                  {/* Category header */}
                  <div
                    style={{
                      padding: "6px 16px 4px",
                      "font-size": "9px",
                      "font-weight": "700",
                      "font-family": "var(--font-mono)",
                      "text-transform": "uppercase",
                      "letter-spacing": "0.10em",
                      color: "var(--ctp-overlay0)",
                    }}
                  >
                    {group.category}
                  </div>

                  <For each={group.items}>
                    {(item) => {
                      const myIdx = flatIdx++;
                      return (
                        <div
                          data-cmd-idx={myIdx}
                          style={{
                            padding: "7px 16px",
                            display: "flex",
                            "align-items": "center",
                            gap: "10px",
                            cursor: "pointer",
                            background:
                              myIdx === selectedIndex()
                                ? "rgba(0,184,255,0.06)"
                                : "transparent",
                            "border-left":
                              myIdx === selectedIndex()
                                ? "2px solid var(--neon-blue, #00b8ff)"
                                : "2px solid transparent",
                            transition: "all 80ms ease",
                          }}
                          onMouseEnter={() => setSelectedIndex(myIdx)}
                          onClick={() => {
                            props.onClose();
                            item.action();
                          }}
                        >
                          {/* Icon */}
                          <Show when={item.icon}>
                            <span
                              style={{
                                "font-size": "14px",
                                "flex-shrink": "0",
                                width: "20px",
                                "text-align": "center",
                                opacity: "0.7",
                              }}
                            >
                              {item.icon}
                            </span>
                          </Show>

                          {/* Label with highlights */}
                          <span style={{ flex: "1", "font-size": "13px", "min-width": "0" }}>
                            <For each={highlightMatch(parsedQuery().text, item.label)}>
                              {(seg) =>
                                seg.match ? (
                                  <span
                                    style={{
                                      color: "var(--neon-green, #00ff9d)",
                                      "font-weight": "700",
                                    }}
                                  >
                                    {seg.text}
                                  </span>
                                ) : (
                                  <span>{seg.text}</span>
                                )
                              }
                            </For>
                          </span>

                          {/* Shortcut badge */}
                          <Show when={item.shortcut}>
                            <span
                              style={{
                                "font-size": "10px",
                                color: "var(--ctp-overlay1)",
                                padding: "2px 6px",
                                background: "rgba(255,255,255,0.04)",
                                border: "1px solid var(--ctp-surface0)",
                                "border-radius": "4px",
                                "font-family": "var(--font-mono)",
                                "flex-shrink": "0",
                              }}
                            >
                              {item.shortcut}
                            </span>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </>
              )}
            </For>

            {/* Empty state */}
            <Show when={flatItems().length === 0}>
              <div
                style={{
                  padding: "32px",
                  "text-align": "center",
                  color: "var(--ctp-overlay0)",
                  "font-size": "12px",
                  "font-family": "var(--font-mono)",
                }}
              >
                No matching commands
              </div>
            </Show>
          </div>

          {/* Footer hints */}
          <div
            style={{
              padding: "6px 16px",
              "border-top": "1px solid var(--ctp-surface0)",
              display: "flex",
              gap: "12px",
              "font-size": "9px",
              "font-family": "var(--font-mono)",
              color: "var(--ctp-overlay0)",
            }}
          >
            <span><kbd style={kbdStyle()}>Tab</kbd> scope</span>
            <span><kbd style={kbdStyle()}>{"\u2191\u2193"}</kbd> navigate</span>
            <span><kbd style={kbdStyle()}>{"\u21B5"}</kbd> select</span>
            <span><kbd style={kbdStyle()}>Esc</kbd> close</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cmd-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cmd-slide-in {
          from { opacity: 0; transform: translateY(-12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </Show>
  );
}

function kbdStyle() {
  return {
    padding: "1px 4px",
    "border-radius": "3px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--ctp-surface0)",
    "font-family": "var(--font-mono)",
    "font-size": "9px",
  };
}
