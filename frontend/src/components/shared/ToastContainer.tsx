import { createSignal, For, onCleanup, onMount } from "solid-js";
import { type Toast, onToast } from "../../lib/notifications";

const MAX_TOASTS = 3;
const DEFAULT_DURATION = 5000;

/** Neon border color per toast type */
function borderColor(type: Toast["type"]): string {
  switch (type) {
    case "success": return "rgba(0,255,157,0.4)";
    case "error": return "rgba(255,68,68,0.4)";
    case "warning": return "rgba(245,158,11,0.4)";
    case "info": return "rgba(0,184,255,0.4)";
  }
}

/** Accent text color per toast type */
function accentColor(type: Toast["type"]): string {
  switch (type) {
    case "success": return "var(--neon-green, #00ff9d)";
    case "error": return "var(--accent-red, #ff4444)";
    case "warning": return "var(--accent-gold, #f59e0b)";
    case "info": return "var(--neon-blue, #00b8ff)";
  }
}

/** Icon per toast type */
function icon(type: Toast["type"]): string {
  switch (type) {
    case "success": return "\u2713";
    case "error": return "\u2717";
    case "warning": return "\u26A0";
    case "info": return "\u2139";
  }
}

interface ToastEntry {
  toast: Toast;
  leaving: boolean;
}

export default function ToastContainer() {
  const [toasts, setToasts] = createSignal<ToastEntry[]>([]);

  const removeToast = (id: string) => {
    // Mark as leaving for exit animation
    setToasts((prev) => prev.map((t) =>
      t.toast.id === id ? { ...t, leaving: true } : t,
    ));
    // Remove after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.toast.id !== id));
    }, 200);
  };

  onMount(() => {
    const unsub = onToast((toast) => {
      setToasts((prev) => {
        const next = [...prev, { toast, leaving: false }];
        // Drop oldest if over max
        while (next.length > MAX_TOASTS) {
          next.shift();
        }
        return next;
      });

      // Auto-dismiss
      const duration = toast.duration ?? DEFAULT_DURATION;
      setTimeout(() => removeToast(toast.id), duration);
    });
    onCleanup(unsub);
  });

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        "z-index": "9999",
        display: "flex",
        "flex-direction": "column-reverse",
        gap: "8px",
        "pointer-events": "none",
        "max-width": "380px",
        width: "100%",
      }}
    >
      <For each={toasts()}>
        {(entry) => (
          <div
            style={{
              "pointer-events": "auto",
              background: "rgba(8,8,16,0.92)",
              "backdrop-filter": "blur(16px)",
              "-webkit-backdrop-filter": "blur(16px)",
              border: `1px solid ${borderColor(entry.toast.type)}`,
              "border-radius": "8px",
              padding: "10px 14px",
              display: "flex",
              "align-items": "flex-start",
              gap: "10px",
              "box-shadow": "0 4px 24px rgba(0,0,0,0.5)",
              animation: entry.leaving
                ? "toast-exit 200ms ease forwards"
                : "toast-enter 300ms ease-out both",
              cursor: "pointer",
            }}
            onClick={() => removeToast(entry.toast.id)}
          >
            {/* Icon */}
            <span
              style={{
                color: accentColor(entry.toast.type),
                "font-size": "16px",
                "line-height": "1",
                "flex-shrink": "0",
                "margin-top": "1px",
              }}
            >
              {icon(entry.toast.type)}
            </span>

            {/* Content */}
            <div style={{ flex: "1", "min-width": "0" }}>
              <div
                style={{
                  "font-size": "12px",
                  "font-weight": "600",
                  color: "var(--ctp-text)",
                  "line-height": "1.3",
                }}
              >
                {entry.toast.title}
              </div>
              {entry.toast.message && (
                <div
                  style={{
                    "font-size": "11px",
                    color: "var(--ctp-subtext0)",
                    "margin-top": "2px",
                    "line-height": "1.4",
                  }}
                >
                  {entry.toast.message}
                </div>
              )}
              {entry.toast.action && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    entry.toast.action!.onClick();
                    removeToast(entry.toast.id);
                  }}
                  style={{
                    "margin-top": "6px",
                    background: "none",
                    border: `1px solid ${accentColor(entry.toast.type)}`,
                    color: accentColor(entry.toast.type),
                    padding: "2px 10px",
                    "border-radius": "4px",
                    "font-size": "10px",
                    "font-weight": "600",
                    cursor: "pointer",
                    transition: "all 150ms ease",
                  }}
                >
                  {entry.toast.action.label}
                </button>
              )}
            </div>

            {/* Close indicator */}
            <span
              style={{
                color: "var(--ctp-overlay0)",
                "font-size": "12px",
                "flex-shrink": "0",
                "line-height": "1",
                "margin-top": "1px",
              }}
            >
              {"\u00D7"}
            </span>
          </div>
        )}
      </For>

      <style>{`
        @keyframes toast-enter {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes toast-exit {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
