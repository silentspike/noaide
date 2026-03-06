import { createSignal, createResource, Show, For } from "solid-js";
import { useSession } from "../../App";
import KanbanBoard from "./KanbanBoard";
import GanttPanel from "../gantt/GanttPanel";
import type { TaskItem } from "./KanbanCard";
import type { GanttTask } from "../gantt/GanttChart";
import type { AgentTime } from "../gantt/TimeTracker";

type ViewMode = "kanban" | "gantt";

interface TeamSummary {
  team_name: string;
  description?: string;
  has_tasks: boolean;
}

interface ApiTask {
  id: string;
  subject: string;
  description?: string;
  active_form?: string;
  status: string;
  owner?: string;
  blocks: string[];
  blocked_by: string[];
  modified_at?: number;
}

export default function TaskPanel() {
  const store = useSession();
  const [viewMode, setViewMode] = createSignal<ViewMode>("kanban");
  const [selectedTeam, setSelectedTeam] = createSignal<string | null>(null);

  const apiUrl = () => store.state.httpApiUrl;

  const fetchTeams = async (): Promise<TeamSummary[]> => {
    const base = apiUrl();
    if (!base) return [];
    const resp = await fetch(`${base}/api/teams`);
    if (!resp.ok) return [];
    return resp.json();
  };

  const [teams] = createResource(() => apiUrl(), fetchTeams);

  // Auto-select first team with tasks
  const activeTeamName = () => {
    const sel = selectedTeam();
    if (sel) return sel;
    const t = teams();
    if (!t || t.length === 0) return null;
    const withTasks = t.find((team) => team.has_tasks);
    return withTasks ? withTasks.team_name : t[0].team_name;
  };

  const fetchTasks = async (teamName: string): Promise<ApiTask[]> => {
    const base = apiUrl();
    if (!base || !teamName) return [];
    const resp = await fetch(
      `${base}/api/teams/${encodeURIComponent(teamName)}/tasks`,
    );
    if (!resp.ok) return [];
    return resp.json();
  };

  const [apiTasks] = createResource(activeTeamName, fetchTasks);

  // Map API tasks to TaskItem[]
  const tasks = (): TaskItem[] => {
    const raw = apiTasks();
    if (!raw) return [];
    return raw.map((t) => ({
      id: t.id,
      subject: t.subject,
      description: t.description,
      status: (t.status === "in_progress" || t.status === "completed"
        ? t.status
        : "pending") as TaskItem["status"],
      owner: t.owner,
      activeForm: t.active_form,
      blocks: t.blocks,
      blockedBy: t.blocked_by,
    }));
  };

  const [localTasks, setLocalTasks] = createSignal<TaskItem[]>([]);

  // Sync API tasks to local state (for drag-and-drop mutations)
  const effectiveTasks = () => {
    const local = localTasks();
    return local.length > 0 ? local : tasks();
  };

  // When API tasks change, reset local state
  createResource(
    () => tasks(),
    (t) => {
      setLocalTasks(t);
      return t;
    },
  );

  const handleStatusChange = (
    taskId: string,
    newStatus: TaskItem["status"],
  ) => {
    setLocalTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
    );
  };

  // Derive GanttTask data from real tasks
  const ganttTasks = (): GanttTask[] => {
    const raw = apiTasks();
    if (!raw || raw.length === 0) return [];

    const times = raw
      .filter((t) => t.modified_at)
      .map((t) => t.modified_at!);
    const minTime = times.length > 0 ? Math.min(...times) : 0;

    return raw.map((t) => {
      const startSec = (t.modified_at ?? minTime) - minTime;
      const durationSec =
        t.status === "completed"
          ? 5000
          : t.status === "in_progress"
            ? 10000
            : 3000;
      return {
        id: t.id,
        subject: t.subject,
        owner: t.owner ?? "unassigned",
        startMs: startSec * 1000,
        endMs: (startSec + durationSec) * 1000,
        status: (t.status === "in_progress" || t.status === "completed"
          ? t.status
          : "pending") as GanttTask["status"],
      };
    });
  };

  // Derive unique agent names
  const agents = (): string[] => {
    const raw = apiTasks();
    if (!raw) return [];
    const names = new Set(raw.map((t) => t.owner ?? "unassigned"));
    return [...names];
  };

  // Derive AgentTime data
  const agentTimes = (): AgentTime[] => {
    const raw = apiTasks();
    if (!raw) return [];

    const byOwner = new Map<string, { active: number; idle: number }>();
    for (const t of raw) {
      const name = t.owner ?? "unassigned";
      const entry = byOwner.get(name) ?? { active: 0, idle: 0 };
      if (t.status === "in_progress") {
        entry.active += 600000; // 10min per active task
      } else {
        entry.idle += 300000; // 5min per idle task
      }
      byOwner.set(name, entry);
    }

    return [...byOwner.entries()].map(([name, times]) => ({
      name,
      activeMs: times.active,
      idleMs: times.idle,
    }));
  };

  const teamsWithTasks = () =>
    (teams() ?? []).filter((t) => t.has_tasks);
  const taskCount = () => effectiveTasks().length;

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
          {taskCount()} total
        </span>
        <Show when={teamsWithTasks().length > 1}>
          <select
            value={activeTeamName() ?? ""}
            onChange={(e) => setSelectedTeam(e.currentTarget.value)}
            style={{
              background: "var(--ctp-surface0)",
              border: "1px solid var(--ctp-surface1)",
              "border-radius": "4px",
              color: "var(--ctp-text)",
              "font-size": "11px",
              padding: "2px 6px",
            }}
          >
            <For each={teamsWithTasks()}>
              {(t) => <option value={t.team_name}>{t.team_name}</option>}
            </For>
          </select>
        </Show>
        <div style={{ "margin-left": "auto", display: "flex", gap: "2px" }}>
          <button
            onClick={() => setViewMode("kanban")}
            style={{
              padding: "3px 10px",
              background:
                viewMode() === "kanban"
                  ? "var(--ctp-surface1)"
                  : "transparent",
              border: "none",
              "border-radius": "4px",
              color:
                viewMode() === "kanban"
                  ? "var(--ctp-text)"
                  : "var(--ctp-overlay0)",
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
              background:
                viewMode() === "gantt"
                  ? "var(--ctp-surface1)"
                  : "transparent",
              border: "none",
              "border-radius": "4px",
              color:
                viewMode() === "gantt"
                  ? "var(--ctp-text)"
                  : "var(--ctp-overlay0)",
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
        <Show
          when={taskCount() > 0}
          fallback={
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                height: "100%",
                color: "var(--ctp-overlay0)",
                "font-size": "12px",
              }}
            >
              {apiTasks.loading
                ? "Loading tasks..."
                : "No tasks found for this team"}
            </div>
          }
        >
          {viewMode() === "kanban" ? (
            <KanbanBoard
              tasks={effectiveTasks()}
              onTaskStatusChange={handleStatusChange}
            />
          ) : (
            <GanttPanel
              tasks={ganttTasks()}
              agents={agents()}
              agentTimes={agentTimes()}
            />
          )}
        </Show>
      </div>
    </div>
  );
}
