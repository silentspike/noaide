import { createSignal } from "solid-js";
import KanbanBoard from "./KanbanBoard";
import GanttPanel from "../gantt/GanttPanel";
import type { TaskItem } from "./KanbanCard";
import type { GanttTask } from "../gantt/GanttChart";
import type { AgentTime } from "../gantt/TimeTracker";

type ViewMode = "kanban" | "gantt";

export default function TaskPanel() {
  const [viewMode, setViewMode] = createSignal<ViewMode>("kanban");

  // Demo data — will be replaced by real data from WebTransport
  const [tasks, setTasks] = createSignal<TaskItem[]>([
    { id: "1", subject: "Set up project scaffolding", status: "completed", owner: "team-lead", createdAt: "2026-02-21T10:00:00Z" },
    { id: "2", subject: "Research API patterns", status: "completed", owner: "researcher", createdAt: "2026-02-21T10:05:00Z" },
    { id: "3", subject: "Implement WebTransport client", status: "in_progress", owner: "implementer", activeForm: "Writing transport code", createdAt: "2026-02-21T10:10:00Z" },
    { id: "4", subject: "Write unit tests for parser", status: "in_progress", owner: "tester", activeForm: "Running tests", createdAt: "2026-02-21T10:15:00Z" },
    { id: "5", subject: "Add error handling", status: "pending", createdAt: "2026-02-21T10:20:00Z" },
    { id: "6", subject: "Performance optimization", status: "pending", createdAt: "2026-02-21T10:25:00Z" },
    { id: "7", subject: "Documentation update", status: "pending", owner: "researcher", createdAt: "2026-02-21T10:30:00Z" },
  ]);

  const handleStatusChange = (taskId: string, newStatus: TaskItem["status"]) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    );
  };

  const agents = ["team-lead", "researcher", "implementer", "tester"];

  const ganttTasks: GanttTask[] = [
    { id: "1", subject: "Scaffolding", owner: "team-lead", startMs: 0, endMs: 5000, status: "completed" },
    { id: "2", subject: "API Research", owner: "researcher", startMs: 3000, endMs: 12000, status: "completed" },
    { id: "3", subject: "WebTransport", owner: "implementer", startMs: 8000, endMs: 25000, status: "in_progress" },
    { id: "4", subject: "Unit Tests", owner: "tester", startMs: 15000, endMs: 22000, status: "in_progress" },
    { id: "5", subject: "Error Handling", owner: "implementer", startMs: 25000, endMs: 35000, status: "pending" },
    { id: "7", subject: "Docs", owner: "researcher", startMs: 20000, endMs: 30000, status: "pending" },
  ];

  const agentTimes: AgentTime[] = [
    { name: "team-lead", activeMs: 300000, idleMs: 120000 },
    { name: "researcher", activeMs: 540000, idleMs: 60000 },
    { name: "implementer", activeMs: 720000, idleMs: 30000 },
    { name: "tester", activeMs: 420000, idleMs: 180000 },
  ];

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--ctp-base)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--ctp-surface0)",
        }}
      >
        <h2
          style={{
            margin: "0",
            "font-size": "13px",
            "font-weight": "600",
            color: "var(--ctp-text)",
          }}
        >
          Tasks
        </h2>
        <span
          style={{
            "font-size": "11px",
            color: "var(--ctp-overlay0)",
          }}
        >
          {tasks().length} total
        </span>
        <div style={{ "margin-left": "auto", display: "flex", gap: "2px" }}>
          <button
            onClick={() => setViewMode("kanban")}
            style={{
              padding: "3px 10px",
              background: viewMode() === "kanban" ? "var(--ctp-surface1)" : "transparent",
              border: "none",
              "border-radius": "4px",
              color: viewMode() === "kanban" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
              "font-size": "11px",
              cursor: "pointer",
            }}
          >
            Kanban
          </button>
          <button
            onClick={() => setViewMode("gantt")}
            style={{
              padding: "3px 10px",
              background: viewMode() === "gantt" ? "var(--ctp-surface1)" : "transparent",
              border: "none",
              "border-radius": "4px",
              color: viewMode() === "gantt" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
              "font-size": "11px",
              cursor: "pointer",
            }}
          >
            Gantt
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: "1", overflow: "hidden" }}>
        {viewMode() === "kanban" ? (
          <KanbanBoard tasks={tasks()} onTaskStatusChange={handleStatusChange} />
        ) : (
          <GanttPanel
            tasks={ganttTasks}
            agents={agents}
            agentTimes={agentTimes}
            totalDurationMs={40000}
          />
        )}
      </div>
    </div>
  );
}
