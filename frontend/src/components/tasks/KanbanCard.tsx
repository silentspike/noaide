import { Show } from "solid-js";

export interface TaskItem {
  id: string;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed";
  owner?: string;
  createdAt?: string;
  activeForm?: string;
}

interface KanbanCardProps {
  task: TaskItem;
  onDragStart?: (id: string) => void;
}

function ownerColor(owner?: string): string {
  if (!owner) return "var(--ctp-overlay0)";
  const colors = [
    "var(--ctp-blue)", "var(--ctp-green)", "var(--ctp-peach)",
    "var(--ctp-mauve)", "var(--ctp-teal)", "var(--ctp-pink)",
    "var(--ctp-sapphire)", "var(--ctp-flamingo)",
  ];
  let hash = 0;
  for (let i = 0; i < owner.length; i++) {
    hash = ((hash << 5) - hash + owner.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

function relativeTime(timestamp?: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export default function KanbanCard(props: KanbanCardProps) {
  return (
    <div
      draggable={true}
      onDragStart={() => props.onDragStart?.(props.task.id)}
      style={{
        padding: "8px 10px",
        background: "var(--ctp-surface0)",
        border: "1px solid var(--ctp-surface1)",
        "border-left": `3px solid ${ownerColor(props.task.owner)}`,
        "border-radius": "6px",
        cursor: "grab",
        "font-size": "12px",
        "user-select": "none",
      }}
    >
      <div
        style={{
          "font-weight": "500",
          color: "var(--ctp-text)",
          "margin-bottom": "4px",
          "line-height": "1.3",
        }}
      >
        {props.task.subject}
      </div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          "font-size": "10px",
          color: "var(--ctp-overlay0)",
        }}
      >
        <Show when={props.task.owner}>
          <span
            style={{
              padding: "1px 5px",
              "border-radius": "3px",
              background: `color-mix(in srgb, ${ownerColor(props.task.owner)} 15%, transparent)`,
              color: ownerColor(props.task.owner),
              "font-weight": "500",
            }}
          >
            {props.task.owner}
          </span>
        </Show>
        <Show when={props.task.activeForm && props.task.status === "in_progress"}>
          <span style={{ "font-style": "italic", color: "var(--ctp-blue)" }}>
            {props.task.activeForm}
          </span>
        </Show>
        <span style={{ "margin-left": "auto" }}>
          {relativeTime(props.task.createdAt)}
        </span>
      </div>
    </div>
  );
}
