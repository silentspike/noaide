import GanttChart, { type GanttTask } from "./GanttChart";
import TimeTracker, { type AgentTime } from "./TimeTracker";

interface GanttPanelProps {
  tasks: GanttTask[];
  agents: string[];
  agentTimes: AgentTime[];
  totalDurationMs?: number;
}

export default function GanttPanel(props: GanttPanelProps) {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        height: "100%",
        overflow: "auto",
        padding: "8px",
      }}
    >
      <TimeTracker agents={props.agentTimes} />
      <div style={{ flex: "1" }}>
        <GanttChart
          tasks={props.tasks}
          agents={props.agents}
          totalDurationMs={props.totalDurationMs}
        />
      </div>
    </div>
  );
}
