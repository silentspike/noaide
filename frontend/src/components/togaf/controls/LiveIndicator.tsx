import { type Component, createMemo } from "solid-js";
import type { ConnectionStatus } from "../stores/plan";

interface Props {
  status: ConnectionStatus;
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<ConnectionStatus, { color: string; label: string; pulse: boolean }> = {
  live:    { color: "var(--green)",   label: "Live",    pulse: true },
  stale:   { color: "var(--yellow)",  label: "Stale",   pulse: false },
  offline: { color: "var(--overlay0)", label: "Offline", pulse: false },
};

const LiveIndicator: Component<Props> = (props) => {
  const config = createMemo(() => STATUS_CONFIG[props.status]);

  return (
    <div style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
      <span style={{
        width: "8px", height: "8px", "border-radius": "50%",
        background: config().color, display: "inline-block",
        animation: config().pulse ? "pulse 2s ease-in-out infinite" : "none",
      }} />
      {(props.showLabel !== false) && (
        <span style={{
          "font-size": "0.75rem", color: "var(--text-muted)",
          "text-transform": "uppercase", "letter-spacing": "0.05em",
        }}>
          {config().label}
        </span>
      )}
    </div>
  );
};

export default LiveIndicator;
