import { createSignal } from "solid-js";
import KanbanColumn from "./KanbanColumn";
import type { TaskItem } from "./KanbanCard";

interface KanbanBoardProps {
  tasks: TaskItem[];
  onTaskStatusChange?: (taskId: string, newStatus: TaskItem["status"]) => void;
}

export default function KanbanBoard(props: KanbanBoardProps) {
  const [draggedId, setDraggedId] = createSignal<string | null>(null);

  const tasksByStatus = (status: TaskItem["status"]) =>
    props.tasks.filter((t) => t.status === status);

  const handleDrop = (newStatus: TaskItem["status"]) => {
    const id = draggedId();
    if (id) {
      props.onTaskStatusChange?.(id, newStatus);
      setDraggedId(null);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        height: "100%",
        padding: "8px",
        overflow: "auto",
      }}
    >
      <KanbanColumn
        title="Backlog"
        status="pending"
        tasks={tasksByStatus("pending")}
        color="var(--ctp-overlay0)"
        onDragStart={setDraggedId}
        onDrop={handleDrop}
      />
      <KanbanColumn
        title="In Progress"
        status="in_progress"
        tasks={tasksByStatus("in_progress")}
        color="var(--ctp-blue)"
        onDragStart={setDraggedId}
        onDrop={handleDrop}
      />
      <KanbanColumn
        title="Done"
        status="completed"
        tasks={tasksByStatus("completed")}
        color="var(--ctp-green)"
        onDragStart={setDraggedId}
        onDrop={handleDrop}
      />
    </div>
  );
}
