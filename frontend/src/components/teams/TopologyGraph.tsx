import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import MessageBubble from "./MessageBubble";
import AgentCard, { type AgentInfo } from "./AgentCard";

interface TopologyNode {
  name: string;
  agentType?: string;
  isLeader: boolean;
  status: "active" | "idle" | "shutdown" | "unknown";
  messageCount: number;
  x: number;
  y: number;
}

interface TopologyEdge {
  from: string;
  to: string;
}

interface AnimatedMessage {
  id: string;
  from: string;
  to: string;
  progress: number;
}

interface TopologyGraphProps {
  agents: AgentInfo[];
  edges?: { from: string; to: string }[];
  messages?: AnimatedMessage[];
  onAgentClick?: (name: string) => void;
}

function statusColor(status: string): string {
  switch (status) {
    case "active": return "var(--ctp-green)";
    case "idle": return "var(--ctp-lavender)";
    case "shutdown": return "var(--ctp-overlay0)";
    default: return "var(--ctp-surface2)";
  }
}

export default function TopologyGraph(props: TopologyGraphProps) {
  const [selectedAgent, setSelectedAgent] = createSignal<string | null>(null);
  const [dimensions, setDimensions] = createSignal({ width: 400, height: 300 });
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (containerRef) {
      const obs = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          setDimensions({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });
      obs.observe(containerRef);
      onCleanup(() => obs.disconnect());
    }
  });

  // Simple circular layout: leader in center, others around
  const layoutNodes = (): TopologyNode[] => {
    const { width, height } = dimensions();
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.3;

    return props.agents.map((agent, i) => {
      if (agent.isLeader) {
        return { ...agent, x: cx, y: cy };
      }
      const nonLeaders = props.agents.filter((a) => !a.isLeader);
      const idx = nonLeaders.findIndex((a) => a.name === agent.name);
      const angle = (2 * Math.PI * idx) / nonLeaders.length - Math.PI / 2;
      return {
        ...agent,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      };
    });
  };

  const nodeMap = () => {
    const map: Record<string, TopologyNode> = {};
    for (const n of layoutNodes()) {
      map[n.name] = n;
    }
    return map;
  };

  const selectedAgentInfo = () => {
    const name = selectedAgent();
    return name ? props.agents.find((a) => a.name === name) : undefined;
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <svg
        width={dimensions().width}
        height={dimensions().height}
        style={{ position: "absolute", top: "0", left: "0" }}
      >
        {/* Edges */}
        <For each={props.edges ?? []}>
          {(edge) => {
            const fromNode = () => nodeMap()[edge.from];
            const toNode = () => nodeMap()[edge.to];
            return (
              <Show when={fromNode() && toNode()}>
                <line
                  x1={fromNode()!.x}
                  y1={fromNode()!.y}
                  x2={toNode()!.x}
                  y2={toNode()!.y}
                  stroke="var(--ctp-surface2)"
                  stroke-width="1.5"
                  stroke-dasharray="4 4"
                  opacity="0.5"
                />
              </Show>
            );
          }}
        </For>

        {/* Animated messages */}
        <For each={props.messages ?? []}>
          {(msg) => {
            const fromNode = () => nodeMap()[msg.from];
            const toNode = () => nodeMap()[msg.to];
            return (
              <Show when={fromNode() && toNode()}>
                <MessageBubble
                  fromX={fromNode()!.x}
                  fromY={fromNode()!.y}
                  toX={toNode()!.x}
                  toY={toNode()!.y}
                  progress={msg.progress}
                />
              </Show>
            );
          }}
        </For>

        {/* Nodes */}
        <For each={layoutNodes()}>
          {(node) => {
            const nodeRadius = () => node.isLeader ? 24 : 18;
            const isSelected = () => selectedAgent() === node.name;
            return (
              <g
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setSelectedAgent(isSelected() ? null : node.name);
                  props.onAgentClick?.(node.name);
                }}
              >
                {/* Outer ring for selected */}
                <Show when={isSelected()}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={nodeRadius() + 4}
                    fill="none"
                    stroke={statusColor(node.status)}
                    stroke-width="2"
                    opacity="0.5"
                  />
                </Show>
                {/* Node circle */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={nodeRadius()}
                  fill="var(--ctp-surface0)"
                  stroke={statusColor(node.status)}
                  stroke-width="2"
                />
                {/* Status dot */}
                <circle
                  cx={node.x + nodeRadius() * 0.6}
                  cy={node.y - nodeRadius() * 0.6}
                  r="4"
                  fill={statusColor(node.status)}
                />
                {/* Name label */}
                <text
                  x={node.x}
                  y={node.y + nodeRadius() + 14}
                  text-anchor="middle"
                  fill="var(--ctp-subtext0)"
                  font-size="10"
                  font-family="var(--font-mono)"
                >
                  {node.name}
                </text>
                {/* Type initial in circle */}
                <text
                  x={node.x}
                  y={node.y + 4}
                  text-anchor="middle"
                  fill="var(--ctp-text)"
                  font-size={node.isLeader ? "12" : "10"}
                  font-weight="600"
                  font-family="var(--font-mono)"
                >
                  {(node.agentType ?? node.name).slice(0, 2).toUpperCase()}
                </text>
              </g>
            );
          }}
        </For>
      </svg>

      {/* Agent detail card overlay */}
      <Show when={selectedAgentInfo()}>
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            "z-index": "10",
          }}
        >
          <AgentCard
            agent={selectedAgentInfo()!}
            onClose={() => setSelectedAgent(null)}
          />
        </div>
      </Show>
    </div>
  );
}
