import { Show, createSignal } from "solid-js";
import type { Session } from "../../stores/session";
import type { OrbState } from "../../types/messages";
import BreathingOrb from "../chat/BreathingOrb";

// Global tick signal — drives reactive relative-time updates every 10s.
// Shared across all SessionCard instances (one timer, not one per card).
const [timeTick, setTimeTick] = createSignal(Date.now());
let tickInterval: ReturnType<typeof setInterval> | null = null;

function ensureTimeTick() {
  if (!tickInterval) {
    tickInterval = setInterval(() => setTimeTick(Date.now()), 10_000);
  }
}

interface SessionCardProps {
  session: Session;
  isActive: boolean;
  orbState: OrbState;
  isPinned?: boolean;
  onClick: () => void;
  onTogglePin?: (id: string) => void;
}

function relativeTime(timestamp: number, _tick?: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** CLI type → accent color for left border + badge */
function cliColor(cliType?: string): string {
  switch (cliType) {
    case "codex":
      return "#10a37f"; // OpenAI green
    case "gemini":
      return "#4285f4"; // Google blue
    default:
      return "#d4a373"; // Claude warm amber
  }
}

/** CLI type → short display label */
function cliLabel(cliType?: string): string {
  switch (cliType) {
    case "codex":
      return "CDX";
    case "gemini":
      return "GEM";
    default:
      return "CLD";
  }
}

/** Format start date compactly: "14:30" if today, "Mar 2" otherwise */
function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Extract meaningful project name from path */
function projectName(path: string): string {
  // Codex date paths like "2026/03/01"
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(path)) return path;
  // Gemini hash prefix like "gemini/2cc974af"
  if (path.startsWith("gemini/")) return path;
  // Full paths like "/work/noaide" or "/work/daw/synth/s1/foundation"
  if (path.startsWith("/")) {
    const parts = path.split("/").filter(Boolean);
    // Skip "work" prefix for brevity, show the rest
    if (parts[0] === "work" && parts.length > 1) {
      return parts.slice(1).join("/");
    }
    return parts.join("/");
  }
  return path;
}

/** Format message count: 55766 → "55.7k" */
function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function SessionCard(props: SessionCardProps) {
  ensureTimeTick();
  const accent = () => cliColor(props.session.cliType);
  const label = () => cliLabel(props.session.cliType);

  return (
    <div
      data-testid={`session-card-${props.session.id}`}
      data-session-id={props.session.id}
      data-cli-type={props.session.cliType ?? "claude"}
      onClick={() => props.onClick()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") props.onClick(); }}
      style={{
        display: "flex",
        "align-items": "stretch",
        width: "100%",
        padding: "0",
        background: props.isActive
          ? `${accent()}0F`
          : "transparent",
        border: props.isActive
          ? `1px solid ${accent()}30`
          : "1px solid transparent",
        "border-radius": "6px",
        cursor: "pointer",
        "text-align": "left",
        color: props.isActive ? "var(--bright, #f0f0f5)" : "var(--ctp-text)",
        transition: "all 200ms ease",
        opacity: props.session.status === "archived" ? "0.4" : "1",
        overflow: "hidden",
        "user-select": "text",
      }}
    >
      {/* Left accent bar — CLI type color */}
      <div
        style={{
          width: "3px",
          "flex-shrink": "0",
          background: accent(),
          "border-radius": "6px 0 0 6px",
          opacity: props.isActive ? "1" : "0.5",
          transition: "opacity 200ms ease",
        }}
      />

      {/* Content area */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 10px",
          flex: "1",
          "min-width": "0",
        }}
      >
        <BreathingOrb state={props.orbState} />

        <div
          style={{
            flex: "1",
            "min-width": "0",
            display: "flex",
            "flex-direction": "column",
            gap: "3px",
          }}
        >

          {/* Row 1: CLI badge + project name */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
            }}
          >
            {/* CLI type badge — ALWAYS visible */}
            <span
              style={{
                "font-family": "var(--font-mono)",
                "font-size": "9px",
                "font-weight": "700",
                padding: "1px 5px",
                "border-radius": "3px",
                "letter-spacing": "0.06em",
                "flex-shrink": "0",
                background: `${accent()}20`,
                color: accent(),
              }}
            >
              {label()}
            </span>

            {/* Project name */}
            <span
              style={{
                "font-size": "12px",
                "font-weight": props.isActive ? "600" : "500",
                "white-space": "nowrap",
                overflow: "hidden",
                "text-overflow": "ellipsis",
              }}
            >
              {projectName(props.session.path)}
            </span>
          </div>

          {/* Row 2: model + time + count */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              "font-size": "10px",
              color: "var(--ctp-overlay1)",
              "font-family": "var(--font-mono)",
            }}
          >
            <Show when={props.session.model}>
              <span
                style={{
                  "font-size": "9px",
                  "font-weight": "600",
                  padding: "1px 4px",
                  "border-radius": "3px",
                  background: "rgba(168,85,247,0.10)",
                  color: "var(--neon-purple, #a855f7)",
                  "letter-spacing": "0.02em",
                  "white-space": "nowrap",
                }}
              >
                {props.session.model!.split("-").slice(0, 2).join("-")}
              </span>
            </Show>
            <span>{relativeTime(props.session.lastActivityAt, timeTick())}</span>
            <span style={{ color: "var(--ctp-surface2)" }}>
              {formatDate(props.session.startedAt)}
            </span>
            <Show when={props.session.messageCount > 0}>
              <span style={{ color: "var(--ctp-overlay0)" }}>
                {formatCount(props.session.messageCount)}
              </span>
            </Show>
          </div>
        </div>

        {/* Pin/Star button */}
        <Show when={props.onTogglePin}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onTogglePin?.(props.session.id);
            }}
            title={props.isPinned ? "Unpin session" : "Pin session"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              "flex-shrink": "0",
              color: props.isPinned ? "var(--accent-gold, #f59e0b)" : "var(--ctp-overlay0)",
              "font-size": "14px",
              transition: "all 150ms ease",
              transform: "scale(1)",
              "line-height": "1",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
            }}
          >
            {props.isPinned ? "\u2605" : "\u2606"}
          </button>
        </Show>
      </div>
    </div>
  );
}
