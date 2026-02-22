import { Show } from "solid-js";

export interface AgentInfo {
  name: string;
  agentId: string;
  agentType?: string;
  isLeader: boolean;
  status: "active" | "idle" | "shutdown" | "unknown";
  messageCount: number;
  currentTask?: string;
  activeDuration?: string;
}

interface AgentCardProps {
  agent: AgentInfo;
  onClose?: () => void;
}

function statusColor(status: string): string {
  switch (status) {
    case "active": return "var(--ctp-green)";
    case "idle": return "var(--ctp-lavender)";
    case "shutdown": return "var(--ctp-overlay0)";
    default: return "var(--ctp-surface2)";
  }
}

export default function AgentCard(props: AgentCardProps) {
  return (
    <div
      style={{
        background: "var(--ctp-surface0)",
        border: "1px solid var(--ctp-surface1)",
        "border-radius": "8px",
        padding: "12px",
        "min-width": "220px",
        "max-width": "280px",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "margin-bottom": "10px",
        }}
      >
        <span
          style={{
            width: "10px",
            height: "10px",
            "border-radius": "50%",
            background: statusColor(props.agent.status),
            "flex-shrink": "0",
          }}
        />
        <span
          style={{
            "font-weight": "600",
            "font-size": "13px",
            color: "var(--ctp-text)",
            flex: "1",
          }}
        >
          {props.agent.name}
        </span>
        <Show when={props.agent.isLeader}>
          <span
            style={{
              "font-size": "9px",
              padding: "1px 5px",
              "border-radius": "3px",
              background: "rgba(249, 226, 175, 0.15)",
              color: "var(--ctp-yellow)",
              "font-weight": "600",
            }}
          >
            LEAD
          </span>
        </Show>
        <Show when={props.onClose}>
          <button
            onClick={() => props.onClose?.()}
            style={{
              background: "none",
              border: "none",
              color: "var(--ctp-overlay0)",
              cursor: "pointer",
              "font-size": "14px",
            }}
          >
            {"\u00D7"}
          </button>
        </Show>
      </div>

      <div style={{ "font-size": "11px", color: "var(--ctp-subtext0)", display: "flex", "flex-direction": "column", gap: "4px" }}>
        <Show when={props.agent.agentType}>
          <div style={{ display: "flex", "justify-content": "space-between" }}>
            <span style={{ color: "var(--ctp-overlay0)" }}>Type</span>
            <span style={{ "font-family": "var(--font-mono)" }}>{props.agent.agentType}</span>
          </div>
        </Show>
        <div style={{ display: "flex", "justify-content": "space-between" }}>
          <span style={{ color: "var(--ctp-overlay0)" }}>Status</span>
          <span style={{ color: statusColor(props.agent.status), "font-weight": "500" }}>{props.agent.status}</span>
        </div>
        <div style={{ display: "flex", "justify-content": "space-between" }}>
          <span style={{ color: "var(--ctp-overlay0)" }}>Messages</span>
          <span>{props.agent.messageCount}</span>
        </div>
        <Show when={props.agent.currentTask}>
          <div style={{ "margin-top": "4px", padding: "4px 6px", background: "var(--ctp-surface1)", "border-radius": "4px" }}>
            <span style={{ color: "var(--ctp-overlay0)", "font-size": "10px" }}>Current task</span>
            <div style={{ "margin-top": "2px", color: "var(--ctp-text)" }}>{props.agent.currentTask}</div>
          </div>
        </Show>
        <Show when={props.agent.activeDuration}>
          <div style={{ display: "flex", "justify-content": "space-between" }}>
            <span style={{ color: "var(--ctp-overlay0)" }}>Duration</span>
            <span>{props.agent.activeDuration}</span>
          </div>
        </Show>
      </div>

      <div
        style={{
          "margin-top": "8px",
          "font-family": "var(--font-mono)",
          "font-size": "9px",
          color: "var(--ctp-overlay0)",
          "word-break": "break-all",
        }}
      >
        {props.agent.agentId}
      </div>
    </div>
  );
}
