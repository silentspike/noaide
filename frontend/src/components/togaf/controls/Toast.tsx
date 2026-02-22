import { type Component, For, createSignal } from "solid-js";

export type ToastType = "info" | "success" | "warning" | "error";

interface ToastMessage {
  id: number;
  text: string;
  type: ToastType;
}

const TOAST_COLORS: Record<ToastType, { bg: string; border: string }> = {
  info:    { bg: "var(--surface0)", border: "var(--blue)" },
  success: { bg: "var(--surface0)", border: "var(--green)" },
  warning: { bg: "var(--surface0)", border: "var(--yellow)" },
  error:   { bg: "var(--surface0)", border: "var(--red)" },
};

let nextId = 0;

/** Global toast state — import and call addToast() from anywhere */
const [toasts, setToasts] = createSignal<ToastMessage[]>([]);

export function addToast(text: string, type: ToastType = "info", durationMs = 4000) {
  const id = nextId++;
  setToasts((prev) => [...prev, { id, text, type }]);

  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, durationMs);
}

export function removeToast(id: number) {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

/** Toast container — render once at the top level */
const ToastContainer: Component = () => {
  return (
    <div style={{
      position: "fixed",
      bottom: "20px",
      right: "20px",
      "z-index": "9999",
      display: "flex",
      "flex-direction": "column-reverse",
      gap: "8px",
      "max-width": "360px",
    }}>
      <For each={toasts()}>
        {(toast) => {
          const colors = TOAST_COLORS[toast.type];
          return (
            <div
              style={{
                background: colors.bg,
                "border-left": `4px solid ${colors.border}`,
                "border-radius": "var(--radius)",
                padding: "10px 14px",
                color: "var(--text-primary)",
                "font-size": "0.85em",
                "box-shadow": "var(--shadow)",
                display: "flex",
                "align-items": "center",
                gap: "8px",
                animation: "slideIn 0.2s ease-out",
              }}
            >
              <span style={{ flex: "1" }}>{toast.text}</span>
              <button
                onClick={() => removeToast(toast.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  "font-size": "1em",
                  padding: "0",
                }}
              >
                x
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
};

export default ToastContainer;
