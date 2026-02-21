import { For } from "solid-js";
import KanbanCard, { type TaskItem } from "./KanbanCard";

interface KanbanColumnProps {
  title: string;
  status: "pending" | "in_progress" | "completed";
  tasks: TaskItem[];
  color: string;
  onDragStart: (id: string) => void;
  onDrop: (status: "pending" | "in_progress" | "completed") => void;
}

export default function KanbanColumn(props: KanbanColumnProps) {
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).style.background = "rgba(88, 91, 112, 0.1)";
  };

  const handleDragLeave = (e: DragEvent) => {
    (e.currentTarget as HTMLElement).style.background = "transparent";
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).style.background = "transparent";
    props.onDrop(props.status);
  };

  return (
    <div
      style={{
        flex: "1",
        "min-width": "200px",
        display: "flex",
        "flex-direction": "column",
        "border-radius": "8px",
        background: "var(--ctp-mantle)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "8px 10px",
          "border-bottom": `2px solid ${props.color}`,
        }}
      >
        <span
          style={{
            "font-size": "11px",
            "font-weight": "600",
            color: "var(--ctp-text)",
            "text-transform": "uppercase",
            "letter-spacing": "0.04em",
          }}
        >
          {props.title}
        </span>
        <span
          style={{
            "font-size": "10px",
            padding: "1px 6px",
            "border-radius": "10px",
            background: "var(--ctp-surface0)",
            color: "var(--ctp-overlay1)",
          }}
        >
          {props.tasks.length}
        </span>
      </div>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          flex: "1",
          padding: "6px",
          display: "flex",
          "flex-direction": "column",
          gap: "4px",
          overflow: "auto",
          "min-height": "60px",
          transition: "background 150ms ease",
        }}
      >
        <For each={props.tasks}>
          {(task) => (
            <KanbanCard task={task} onDragStart={props.onDragStart} />
          )}
        </For>
      </div>
    </div>
  );
}
