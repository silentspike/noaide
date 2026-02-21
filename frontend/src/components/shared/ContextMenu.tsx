import { createSignal, For, Show, onMount, onCleanup } from "solid-js";

export interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export default function ContextMenu(props: {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  let menuRef: HTMLDivElement | undefined;

  onMount(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    onCleanup(() => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    });
  });

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: `${props.x}px`,
        top: `${props.y}px`,
        "z-index": "1001",
        "min-width": "160px",
        background: "rgba(49, 50, 68, 0.85)",
        "backdrop-filter": "blur(12px)",
        "border-radius": "8px",
        border: "1px solid var(--ctp-surface2)",
        padding: "4px 0",
        "box-shadow": "0 8px 32px rgba(0, 0, 0, 0.4)",
      }}
    >
      <For each={props.items}>
        {(item) => (
          <Show
            when={!item.separator}
            fallback={
              <div
                style={{
                  height: "1px",
                  background: "var(--ctp-surface2)",
                  margin: "4px 8px",
                }}
              />
            }
          >
            <div
              style={{
                padding: "6px 16px",
                "font-size": "13px",
                color: item.disabled ? "var(--ctp-overlay0)" : "var(--ctp-text)",
                cursor: item.disabled ? "default" : "pointer",
                opacity: item.disabled ? "0.5" : "1",
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "var(--ctp-surface1)";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
              onClick={() => {
                if (!item.disabled) {
                  item.action();
                  props.onClose();
                }
              }}
            >
              {item.label}
            </div>
          </Show>
        )}
      </For>
    </div>
  );
}
