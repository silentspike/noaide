import { createSignal, createResource, For, Show } from "solid-js";
import { useSession } from "../../App";
import TopologyGraph from "./TopologyGraph";
import SwimlaneTL, { type SwimlaneBlock } from "./SwimlaneTL";
import type { AgentInfo } from "./AgentCard";

type ViewMode = "topology" | "swimlane";

interface TeamSummary {
  team_name: string;
  description?: string;
  members: {
    name: string;
    agentId: string;
    agentType?: string;
  }[];
  has_tasks: boolean;
}

interface TopologyData {
  team_name: string;
  nodes: {
    name: string;
    agent_id: string;
    agent_type?: string;
    is_leader: boolean;
    children: string[];
    message_count: number;
    status: string;
  }[];
  edges: {
    from: string;
    to: string;
    message_type: string;
    timestamp: number;
    summary?: string;
  }[];
}

export default function TeamsPanel() {
  const store = useSession();
  const [viewMode, setViewMode] = createSignal<ViewMode>("topology");
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

  // Auto-select first team when teams load
  const activeTeamName = () => {
    const sel = selectedTeam();
    if (sel) return sel;
    const t = teams();
    return t && t.length > 0 ? t[0].team_name : null;
  };

  const fetchTopology = async (teamName: string): Promise<TopologyData | null> => {
    const base = apiUrl();
    if (!base || !teamName) return null;
    const resp = await fetch(`${base}/api/teams/${encodeURIComponent(teamName)}/topology`);
    if (!resp.ok) return null;
    return resp.json();
  };

  const [topology] = createResource(activeTeamName, fetchTopology);

  // Transform topology nodes to AgentInfo for TopologyGraph
  const agents = (): AgentInfo[] => {
    const topo = topology();
    if (!topo) return [];
    return topo.nodes.map((n) => ({
      name: n.name,
      agentId: n.agent_id,
      agentType: n.agent_type,
      isLeader: n.is_leader,
      status: (n.status === "active" || n.status === "idle" || n.status === "shutdown")
        ? n.status as "active" | "idle" | "shutdown"
        : "unknown",
      messageCount: n.message_count,
    }));
  };

  const edges = () => {
    const topo = topology();
    if (!topo) return [];
    // Build edges from leader to children
    const leader = topo.nodes.find((n) => n.is_leader);
    if (!leader) return [];
    return leader.children.map((child) => ({
      from: leader.name,
      to: child,
    }));
  };

  // Build swimlane blocks from topology (each agent gets a placeholder block based on status)
  const swimlaneBlocks = (): SwimlaneBlock[] => {
    const a = agents();
    if (a.length === 0) return [];
    return a.map((agent) => ({
      agentName: agent.name,
      startMs: 0,
      endMs: 10000,
      state: agent.status === "active" ? "active" as const
        : agent.status === "idle" ? "idle" as const
        : "thinking" as const,
      label: agent.currentTask,
    }));
  };

  const agentNames = () => agents().map((a) => a.name);
  const teamCount = () => (teams() ?? []).length;
  const agentCount = () => agents().length;

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--ctp-base)",
      }}
    >
      {/* Header with view toggle */}
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
          Team
        </h2>
        <span
          style={{
            "font-size": "11px",
            color: "var(--ctp-overlay0)",
          }}
        >
          {agentCount()} agents
        </span>
        <Show when={teamCount() > 1}>
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
            <For each={teams() ?? []}>
              {(t) => <option value={t.team_name}>{t.team_name}</option>}
            </For>
          </select>
        </Show>
        <div style={{ "margin-left": "auto", display: "flex", gap: "2px" }}>
          <button
            onClick={() => setViewMode("topology")}
            style={{
              padding: "3px 10px",
              background: viewMode() === "topology" ? "var(--ctp-surface1)" : "transparent",
              border: "none",
              "border-radius": "4px",
              color: viewMode() === "topology" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
              "font-size": "11px",
              cursor: "pointer",
            }}
          >
            Graph
          </button>
          <button
            onClick={() => setViewMode("swimlane")}
            style={{
              padding: "3px 10px",
              background: viewMode() === "swimlane" ? "var(--ctp-surface1)" : "transparent",
              border: "none",
              "border-radius": "4px",
              color: viewMode() === "swimlane" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
              "font-size": "11px",
              cursor: "pointer",
            }}
          >
            Timeline
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: "1", overflow: "hidden" }}>
        <Show
          when={agentCount() > 0}
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
              {teams.loading ? "Loading teams..." : "No active teams found"}
            </div>
          }
        >
          <Show when={viewMode() === "topology"}>
            <TopologyGraph agents={agents()} edges={edges()} />
          </Show>
          <Show when={viewMode() === "swimlane"}>
            <div style={{ padding: "8px" }}>
              <SwimlaneTL
                agents={agentNames()}
                blocks={swimlaneBlocks()}
              />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
