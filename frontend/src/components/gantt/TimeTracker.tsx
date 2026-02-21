import { For } from "solid-js";

export interface AgentTime {
  name: string;
  activeMs: number;
  idleMs: number;
}

interface TimeTrackerProps {
  agents: AgentTime[];
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function TimeTracker(props: TimeTrackerProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        padding: "8px",
        "flex-wrap": "wrap",
      }}
    >
      <For each={props.agents}>
        {(agent) => {
          const total = () => agent.activeMs + agent.idleMs;
          const activePercent = () => total() > 0 ? (agent.activeMs / total()) * 100 : 0;

          return (
            <div
              style={{
                padding: "6px 10px",
                background: "var(--ctp-surface0)",
                "border-radius": "6px",
                "font-size": "11px",
                "min-width": "150px",
              }}
            >
              <div
                style={{
                  "font-weight": "600",
                  color: "var(--ctp-text)",
                  "margin-bottom": "4px",
                  "font-family": "var(--font-mono)",
                }}
              >
                {agent.name}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  "font-size": "10px",
                  color: "var(--ctp-subtext0)",
                  "margin-bottom": "4px",
                }}
              >
                <span>
                  <span style={{ color: "var(--ctp-green)" }}>{formatDuration(agent.activeMs)}</span> active
                </span>
                <span>
                  <span style={{ color: "var(--ctp-overlay0)" }}>{formatDuration(agent.idleMs)}</span> idle
                </span>
              </div>
              <div
                style={{
                  height: "3px",
                  "border-radius": "2px",
                  background: "var(--ctp-surface1)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${activePercent()}%`,
                    background: "var(--ctp-green)",
                    "border-radius": "2px",
                  }}
                />
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
