import { createSignal, createEffect, Show, onMount, onCleanup } from "solid-js";

interface SearchBarProps {
  open: boolean;
  onClose: () => void;
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  matchCount: number;
  currentMatch: number;
}

export default function SearchBar(props: SearchBarProps) {
  let inputRef: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal("");
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Auto-focus when opened
  createEffect(() => {
    if (props.open && inputRef) {
      requestAnimationFrame(() => inputRef?.focus());
    }
  });

  // Keyboard shortcuts inside search
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      props.onSearch("");
      props.onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        props.onPrev();
      } else {
        props.onNext();
      }
    }
  }

  // Global Cmd+F listener
  function handleGlobalKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "f" && !props.open) {
      // Let parent handle opening
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleGlobalKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener("keydown", handleGlobalKeyDown);
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  function onInput(value: string) {
    setQuery(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      props.onSearch(value);
    }, 150);
  }

  return (
    <Show when={props.open}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "6px 12px",
          background: "rgba(8,8,16,0.92)",
          "backdrop-filter": "blur(16px)",
          "-webkit-backdrop-filter": "blur(16px)",
          "border-bottom": "1px solid var(--ctp-surface1)",
          animation: "search-slide-down 200ms ease-out",
        }}
      >
        {/* Search icon */}
        <span
          style={{
            color: "var(--ctp-overlay1)",
            "font-size": "13px",
            "flex-shrink": "0",
          }}
        >
          {"\u2315"}
        </span>

        {/* Input */}
        <input
          ref={inputRef}
          data-testid="search-input"
          aria-label="Search messages"
          type="text"
          placeholder="Search messages..."
          value={query()}
          onInput={(e) => onInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex: "1",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--ctp-text)",
            "font-size": "12px",
            "font-family": "var(--font-mono)",
            padding: "4px 0",
          }}
        />

        {/* Match counter */}
        <Show when={query().length > 0}>
          <span
            style={{
              "font-size": "10px",
              "font-family": "var(--font-mono)",
              color: props.matchCount > 0 ? "var(--ctp-subtext0)" : "var(--accent-red, #ff4444)",
              "white-space": "nowrap",
              "flex-shrink": "0",
            }}
          >
            {props.matchCount > 0
              ? `${props.currentMatch + 1} of ${props.matchCount}`
              : "No matches"}
          </span>
        </Show>

        {/* Prev/Next buttons */}
        <Show when={props.matchCount > 0}>
          <button
            onClick={() => props.onPrev()}
            title="Previous match (Shift+Enter)"
            style={navButtonStyle()}
          >
            {"\u25B2"}
          </button>
          <button
            onClick={() => props.onNext()}
            title="Next match (Enter)"
            style={navButtonStyle()}
          >
            {"\u25BC"}
          </button>
        </Show>

        {/* Close */}
        <button
          onClick={() => {
            setQuery("");
            props.onSearch("");
            props.onClose();
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--ctp-overlay0)",
            cursor: "pointer",
            "font-size": "14px",
            padding: "2px 4px",
            "line-height": "1",
            "flex-shrink": "0",
          }}
        >
          {"\u00D7"}
        </button>

        <style>{`
          @keyframes search-slide-down {
            from { transform: translateY(-100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>
      </div>
    </Show>
  );
}

function navButtonStyle() {
  return {
    background: "none",
    border: "1px solid var(--ctp-surface1)",
    "border-radius": "3px",
    color: "var(--ctp-overlay1)",
    cursor: "pointer",
    "font-size": "8px",
    padding: "3px 6px",
    "line-height": "1",
    "flex-shrink": "0",
    transition: "all 150ms ease",
  };
}
