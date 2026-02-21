import type { ConnectionStatus } from "../../transport/client";

interface SessionStatusProps {
  connectionStatus: ConnectionStatus;
  sessionCount: number;
}

export default function SessionStatus(props: SessionStatusProps) {
  const statusColor = () => {
    switch (props.connectionStatus) {
      case "connected":
        return "var(--ctp-green)";
      case "connecting":
        return "var(--ctp-yellow)";
      default:
        return "var(--ctp-overlay0)";
    }
  };

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "8px 12px",
        "border-bottom": "1px solid var(--ctp-surface0)",
        "font-size": "11px",
        color: "var(--ctp-overlay1)",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
        }}
      >
        <div
          style={{
            width: "6px",
            height: "6px",
            "border-radius": "50%",
            background: statusColor(),
            "flex-shrink": "0",
          }}
        />
        {props.connectionStatus}
      </div>
      <span>{props.sessionCount} sessions</span>
    </div>
  );
}
