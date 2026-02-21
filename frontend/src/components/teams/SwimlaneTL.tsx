import { For, createSignal, createMemo } from "solid-js";

export interface SwimlaneBlock {
  agentName: string;
  startMs: number;
  endMs: number;
  state: "idle" | "thinking" | "active" | "tool_use" | "error";
  label?: string;
}

interface SwimlaneTLProps {
  agents: string[];
  blocks: SwimlaneBlock[];
  totalDurationMs?: number;
}

function stateColor(state: string): string {
  switch (state) {
    case "idle": return "var(--ctp-surface2)";
    case "thinking": return "var(--ctp-mauve)";
    case "active": return "var(--ctp-blue)";
    case "tool_use": return "var(--ctp-peach)";
    case "error": return "var(--ctp-red)";
    default: return "var(--ctp-surface1)";
  }
}

export default function SwimlaneTL(props: SwimlaneTLProps) {
  const [zoom, setZoom] = createSignal(1);
  const rowHeight = 28;
  const headerWidth = 100;

  const totalMs = createMemo(() => {
    if (props.totalDurationMs) return props.totalDurationMs;
    const maxEnd = Math.max(...props.blocks.map((b) => b.endMs), 0);
    return maxEnd || 60000;
  });

  const timeToX = (ms: number) => {
    const availableWidth = 600 * zoom();
    return headerWidth + (ms / totalMs()) * availableWidth;
  };

  const blockWidth = (block: SwimlaneBlock) => {
    const w = timeToX(block.endMs) - timeToX(block.startMs);
    return Math.max(2, w);
  };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };

  // Time axis ticks
  const ticks = createMemo(() => {
    const total = totalMs();
    const count = Math.min(10, Math.max(3, Math.floor(total / 10000)));
    const step = total / count;
    return Array.from({ length: count + 1 }, (_, i) => i * step);
  });

  return (
    <div
      style={{
        overflow: "auto",
        background: "var(--ctp-mantle)",
        "border-radius": "6px",
        border: "1px solid var(--ctp-surface0)",
      }}
    >
      {/* Zoom controls */}
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
          style={{
            background: "var(--ctp-surface0)",
            border: "none",
            color: "var(--ctp-text)",
            "border-radius": "3px",
            padding: "1px 6px",
            cursor: "pointer",
          }}
        >
          -
        </button>
        <span>{Math.round(zoom() * 100)}%</span>
        <button
          onClick={() => setZoom(Math.min(4, zoom() + 0.25))}
          style={{
            background: "var(--ctp-surface0)",
            border: "none",
            color: "var(--ctp-text)",
            "border-radius": "3px",
            padding: "1px 6px",
            cursor: "pointer",
          }}
        >
          +
        </button>
        <span style={{ "margin-left": "auto" }}>
          Total: {formatTime(totalMs())}
        </span>
      </div>

      <div style={{ overflow: "auto", position: "relative" }}>
        <svg
          width={headerWidth + 600 * zoom() + 20}
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
                  y2={props.agents.length * rowHeight + 20}
                  stroke="var(--ctp-surface0)"
                  stroke-width="1"
                />
                <text
                  x={timeToX(tick)}
                  y={props.agents.length * rowHeight + 28}
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

          {/* Swim lanes */}
          <For each={props.agents}>
            {(agent, i) => (
              <g>
                {/* Lane background */}
                <rect
                  x={0}
                  y={i() * rowHeight}
                  width={headerWidth + 600 * zoom() + 20}
                  height={rowHeight}
                  fill={i() % 2 === 0 ? "transparent" : "rgba(88, 91, 112, 0.05)"}
                />
                {/* Agent name */}
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

          {/* Activity blocks */}
          <For each={props.blocks}>
            {(block) => {
              const agentIdx = () => props.agents.indexOf(block.agentName);
              return (
                <rect
                  x={timeToX(block.startMs)}
                  y={agentIdx() * rowHeight + 4}
                  width={blockWidth(block)}
                  height={rowHeight - 8}
                  rx="3"
                  fill={stateColor(block.state)}
                  opacity="0.8"
                >
                  <title>{block.label ?? block.state}: {formatTime(block.endMs - block.startMs)}</title>
                </rect>
              );
            }}
          </For>
        </svg>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          padding: "6px 8px",
          "border-top": "1px solid var(--ctp-surface0)",
          "font-size": "10px",
          color: "var(--ctp-overlay0)",
        }}
      >
        {(["active", "thinking", "tool_use", "idle", "error"] as const).map((state) => (
          <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                "border-radius": "2px",
                background: stateColor(state),
              }}
            />
            {state}
          </div>
        ))}
      </div>
    </div>
  );
}
