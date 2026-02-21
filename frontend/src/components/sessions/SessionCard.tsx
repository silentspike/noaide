import { Show } from "solid-js";
import type { Session } from "../../stores/session";
import type { OrbState } from "../../types/messages";
import BreathingOrb from "../chat/BreathingOrb";

interface SessionCardProps {
  session: Session;
  isActive: boolean;
  orbState: OrbState;
  onClick: () => void;
}

function relativeTime(timestamp: number): string {
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

function shortPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export default function SessionCard(props: SessionCardProps) {
  return (
    <button
      onClick={props.onClick}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "10px",
        width: "100%",
        padding: "10px 12px",
        background: props.isActive
          ? "var(--ctp-surface0)"
          : "transparent",
        border: "none",
        "border-radius": "8px",
        cursor: "pointer",
        "text-align": "left",
        color: "var(--ctp-text)",
        transition: "background 150ms ease",
        opacity: props.session.status === "archived" ? "0.5" : "1",
      }}
    >
      <BreathingOrb state={props.orbState} />

      <div
        style={{
          flex: "1",
          "min-width": "0",
          display: "flex",
          "flex-direction": "column",
          gap: "2px",
        }}
      >
        <div
          style={{
            "font-size": "13px",
            "font-weight": props.isActive ? "600" : "400",
            "white-space": "nowrap",
            overflow: "hidden",
            "text-overflow": "ellipsis",
          }}
        >
          {shortPath(props.session.path)}
        </div>

        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            "font-size": "11px",
            color: "var(--ctp-overlay1)",
          }}
        >
          <Show when={props.session.model}>
            <span
              style={{
                "font-family": "var(--font-mono)",
                "font-size": "10px",
                padding: "1px 4px",
                "border-radius": "3px",
                background: "var(--ctp-surface1)",
              }}
            >
              {props.session.model!.split("-").slice(0, 2).join("-")}
            </span>
          </Show>
          <span>{relativeTime(props.session.startedAt)}</span>
          <span>{props.session.messageCount} msgs</span>
        </div>
      </div>
    </button>
  );
}
