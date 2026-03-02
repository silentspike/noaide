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
        padding: "6px 12px",
        "border-bottom": "1px solid var(--ctp-surface1)",
        "font-size": "10px",
        "font-family": "var(--font-mono)",
        color: "var(--dim, #68687a)",
        "letter-spacing": "0.03em",
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
            "box-shadow": `0 0 6px ${statusColor()}`,
            "flex-shrink": "0",
          }}
        />
        {props.connectionStatus}
      </div>
      <span>{props.sessionCount} sessions</span>
    </div>
  );
}
