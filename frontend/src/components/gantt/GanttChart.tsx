import { createSignal, createMemo, For } from "solid-js";
import GanttBar from "./GanttBar";

export interface GanttTask {
  id: string;
  subject: string;
  owner: string;
  startMs: number;
  endMs: number;
  status: "pending" | "in_progress" | "completed";
}

interface GanttChartProps {
  tasks: GanttTask[];
  agents: string[];
  totalDurationMs?: number;
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "var(--ctp-green)";
    case "in_progress": return "var(--ctp-blue)";
    default: return "var(--ctp-overlay0)";
  }
}

export default function GanttChart(props: GanttChartProps) {
  const [zoom, setZoom] = createSignal(1);
  const rowHeight = 32;
  const headerWidth = 100;
  const chartWidth = () => 600 * zoom();

  const totalMs = createMemo(() => {
    if (props.totalDurationMs) return props.totalDurationMs;
    return Math.max(...props.tasks.map((t) => t.endMs), 60000);
  });

  const timeToX = (ms: number) => headerWidth + (ms / totalMs()) * chartWidth();
  const barWidth = (task: GanttTask) => Math.max(4, timeToX(task.endMs) - timeToX(task.startMs));

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m` : `${s}s`;
  };

  const ticks = createMemo(() => {
    const total = totalMs();
    const count = Math.min(12, Math.max(3, Math.floor(total / 10000)));
    const step = total / count;
    return Array.from({ length: count + 1 }, (_, i) => i * step);
  });

  return (
    <div
      style={{
        background: "var(--ctp-mantle)",
        "border-radius": "6px",
        border: "1px solid var(--ctp-surface0)",
        overflow: "hidden",
      }}
    >
      {/* Zoom */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "6px 8px",
          "border-bottom": "1px solid var(--ctp-surface0)",
          "font-size": "10px",
          color: "var(--ctp-overlay0)",
        }}
      >
        <span>Zoom:</span>
        <button
          onClick={() => setZoom(Math.max(0.5, zoom() - 0.25))}
          style={{ background: "var(--ctp-surface0)", border: "none", color: "var(--ctp-text)", "border-radius": "3px", padding: "1px 6px", cursor: "pointer" }}
        >
          -
        </button>
        <span>{Math.round(zoom() * 100)}%</span>
        <button
          onClick={() => setZoom(Math.min(4, zoom() + 0.25))}
          style={{ background: "var(--ctp-surface0)", border: "none", color: "var(--ctp-text)", "border-radius": "3px", padding: "1px 6px", cursor: "pointer" }}
        >
          +
        </button>
      </div>

      <div style={{ overflow: "auto" }}>
        <svg
          width={headerWidth + chartWidth() + 20}
          height={props.agents.length * rowHeight + 30}
        >
          {/* Time axis */}
          <For each={ticks()}>
            {(tick) => (
              <g>
                <line
                  x1={timeToX(tick)}
                  y1={0}
                  x2={timeToX(tick)}
                  y2={props.agents.length * rowHeight}
                  stroke="var(--ctp-surface0)"
                  stroke-width="1"
                />
                <text
                  x={timeToX(tick)}
                  y={props.agents.length * rowHeight + 18}
                  text-anchor="middle"
                  fill="var(--ctp-overlay0)"
                  font-size="9"
                  font-family="var(--font-mono)"
                >
                  {formatTime(tick)}
                </text>
              </g>
            )}
          </For>

          {/* Agent rows */}
          <For each={props.agents}>
            {(agent, i) => (
              <g>
                <rect
                  x={0}
                  y={i() * rowHeight}
                  width={headerWidth + chartWidth() + 20}
                  height={rowHeight}
                  fill={i() % 2 === 0 ? "transparent" : "rgba(88, 91, 112, 0.05)"}
                />
                <text
                  x={8}
                  y={i() * rowHeight + rowHeight / 2 + 4}
                  fill="var(--ctp-subtext0)"
                  font-size="10"
                  font-family="var(--font-mono)"
                >
                  {agent.length > 12 ? agent.slice(0, 12) + ".." : agent}
                </text>
              </g>
            )}
          </For>

          {/* Task bars */}
          <For each={props.tasks}>
            {(task) => {
              const agentIdx = () => props.agents.indexOf(task.owner);
              return agentIdx() >= 0 ? (
                <GanttBar
                  x={timeToX(task.startMs)}
                  width={barWidth(task)}
                  y={agentIdx() * rowHeight + 6}
                  height={rowHeight - 12}
                  color={statusColor(task.status)}
                  label={task.subject}
                  owner={task.owner}
                />
              ) : null;
            }}
          </For>
        </svg>
      </div>
    </div>
  );
}
