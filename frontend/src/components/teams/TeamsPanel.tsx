import { createSignal, createResource, For, Show, onCleanup } from "solid-js";
import { useSession } from "../../App";
import TopologyGraph from "./TopologyGraph";
import SwimlaneTL, { type SwimlaneBlock } from "./SwimlaneTL";
import SubagentTree from "./SubagentTree";
import type { AgentInfo } from "./AgentCard";

type ViewMode = "topology" | "swimlane" | "subagents" | "issues";

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

interface TaskItem {
  id: string;
  subject: string;
  status: string;
  owner?: string;
  modified_at?: number;
}

export default function TeamsPanel() {
  const store = useSession();
  const [viewMode, setViewMode] = createSignal<ViewMode>("topology");
  const [selectedTeam, setSelectedTeam] = createSignal<string | null>(null);
  const [pollTick, setPollTick] = createSignal(0);

  const apiUrl = () => store.state.httpApiUrl;

  // Poll every 1s for live team updates
  const pollInterval = setInterval(() => setPollTick((t) => t + 1), 1000);
  onCleanup(() => clearInterval(pollInterval));

  const fetchTeams = async (): Promise<TeamSummary[]> => {
    const base = apiUrl();
    if (!base) return [];
    const resp = await fetch(`${base}/api/teams`);
    if (!resp.ok) return [];
    return resp.json();
  };

  // Re-fetch teams every 10 ticks (10s) — team list changes rarely
  const teamsSource = () => {
    const base = apiUrl();
    if (!base) return null;
    return `${base}:${Math.floor(pollTick() / 10)}`;
  };
  const [teams] = createResource(teamsSource, fetchTeams);

  // Auto-select first team when teams load
  const activeTeamName = () => {
    const sel = selectedTeam();
    if (sel) return sel;
    const t = teams();
    return t && t.length > 0 ? t[0].team_name : null;
  };

  const fetchTopology = async (_key: string): Promise<TopologyData | null> => {
    const teamName = activeTeamName();
    const base = apiUrl();
    if (!base || !teamName) return null;
    const resp = await fetch(`${base}/api/teams/${encodeURIComponent(teamName)}/topology`);
    if (!resp.ok) return null;
    return resp.json();
  };

  // Re-fetch topology every tick (1s) for live updates
  const topoSource = () => {
    const name = activeTeamName();
    if (!name) return null;
    return `${name}:${pollTick()}`;
  };
  const [topology] = createResource(topoSource, fetchTopology);

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

  // Use real edges from topology API (deduplicated by unique from→to pairs)
  const edges = () => {
    const topo = topology();
    if (!topo || !topo.edges || topo.edges.length === 0) {
      // Fallback to leader→children if no message edges
      const leader = topo?.nodes.find((n) => n.is_leader);
      if (!leader) return [];
      return leader.children.map((child) => ({ from: leader.name, to: child }));
    }
    // Deduplicate edges by from→to pair
    const seen = new Set<string>();
    return topo.edges.filter((e) => {
      const key = `${e.from}->${e.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((e) => ({ from: e.from, to: e.to }));
  };

  const fetchTasks = async (_key: string): Promise<TaskItem[]> => {
    const teamName = activeTeamName();
    const base = apiUrl();
    if (!base || !teamName) return [];
    const resp = await fetch(`${base}/api/teams/${encodeURIComponent(teamName)}/tasks`);
    if (!resp.ok) return [];
    return resp.json();
  };

  // Re-fetch tasks every tick (1s)
  const tasksSource = () => {
    const name = activeTeamName();
    if (!name) return null;
    return `tasks:${name}:${pollTick()}`;
  };
  const [tasks] = createResource(tasksSource, fetchTasks);

  // Build swimlane blocks from real task data
  const swimlaneBlocks = (): SwimlaneBlock[] => {
    const taskList = tasks() ?? [];
    const a = agents();
    if (a.length === 0) return [];

    if (taskList.length === 0) {
      // No tasks — use topology status as single block per agent
      return a.map((agent) => ({
        agentName: agent.name,
        startMs: 0,
        endMs: agent.messageCount > 0 ? Math.min(agent.messageCount * 500, 30000) : 5000,
        state: agent.status === "active" ? "active" as const
          : agent.status === "shutdown" ? "idle" as const
          : agent.messageCount > 0 ? "active" as const
          : "idle" as const,
        label: undefined,
      }));
    }

    // Group tasks by owner, build time blocks from task order + modified_at
    const blocks: SwimlaneBlock[] = [];
    const tasksByOwner = new Map<string, TaskItem[]>();
    for (const t of taskList) {
      const owner = t.owner ?? "unassigned";
      if (!tasksByOwner.has(owner)) tasksByOwner.set(owner, []);
      tasksByOwner.get(owner)!.push(t);
    }

    // Find earliest and latest timestamps for normalization
    const timestamps = taskList.filter((t) => t.modified_at).map((t) => t.modified_at!);
    const minTs = timestamps.length > 0 ? Math.min(...timestamps) : 0;
    const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : minTs + 60;
    const span = Math.max(maxTs - minTs, 1);

    for (const [owner, ownerTasks] of tasksByOwner) {
      for (const t of ownerTasks) {
        const relStart = t.modified_at ? ((t.modified_at - minTs) / span) * 30000 : 0;
        const duration = t.status === "completed" ? 3000 : t.status === "in_progress" ? 5000 : 2000;
        blocks.push({
          agentName: owner,
          startMs: Math.round(relStart),
          endMs: Math.round(relStart + duration),
          state: t.status === "completed" ? "idle" as const
            : t.status === "in_progress" ? "active" as const
            : "thinking" as const,
          label: t.subject,
        });
      }
    }

    return blocks;
  };

  const agentNames = () => {
    const names = new Set(agents().map((a) => a.name));
    // Also include task owners not in topology
    for (const t of tasks() ?? []) {
      if (t.owner) names.add(t.owner);
    }
    return [...names];
  };
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
          <button
            onClick={() => setViewMode("subagents")}
            style={{
              padding: "3px 10px",
              background: viewMode() === "subagents" ? "var(--ctp-surface1)" : "transparent",
              border: "none",
              "border-radius": "4px",
              color: viewMode() === "subagents" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
              "font-size": "11px",
              cursor: "pointer",
            }}
          >
            Subagents
          </button>
          <button
            onClick={() => setViewMode("issues")}
            style={{
              padding: "3px 10px",
              background: viewMode() === "issues" ? "var(--ctp-surface1)" : "transparent",
              border: "none",
              "border-radius": "4px",
              color: viewMode() === "issues" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
              "font-size": "11px",
              cursor: "pointer",
            }}
          >
            Issues
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: "1", overflow: "hidden" }}>
        <Show when={viewMode() === "issues"}>
          <GitHubIssuesView />
        </Show>
        <Show
          when={viewMode() !== "issues" && agentCount() > 0}
          fallback={
            <Show when={viewMode() !== "issues"}>
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
            </Show>
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
          <Show when={viewMode() === "subagents"}>
            <SubagentTree messages={store.activeMessages()} />
          </Show>
        </Show>
      </div>
    </div>
  );
}

/** Inline GitHub Issues view — fetches from repo API if configured */
function GitHubIssuesView() {
  const [issues, setIssues] = createSignal<Array<{ number: number; title: string; state: string; labels: string[]; updated_at: string }>>([]);
  const [loading, setLoading] = createSignal(true);
  const [repo, setRepo] = createSignal(localStorage.getItem("noaide-github-repo") || "");

  async function fetchIssues(repoSlug: string) {
    if (!repoSlug) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`https://api.github.com/repos/${repoSlug}/issues?per_page=30&state=all`);
      if (res.ok) {
        const data = await res.json();
        setIssues(data.map((i: Record<string, unknown>) => ({
          number: i.number as number,
          title: i.title as string,
          state: i.state as string,
          labels: ((i.labels as Array<{ name: string }>) ?? []).map((l) => l.name),
          updated_at: i.updated_at as string,
        })));
      }
    } catch { /* CORS may block — that's OK */ }
    setLoading(false);
  }

  // Fetch on mount if repo is set
  if (repo()) fetchIssues(repo());

  return (
    <div style={{ padding: "12px", overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", gap: "6px", "margin-bottom": "12px" }}>
        <input
          data-testid="github-repo-input"
          aria-label="GitHub repository (owner/repo)"
          type="text"
          placeholder="owner/repo (e.g. silentspike/noaide)"
          value={repo()}
          onInput={(e) => setRepo(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              localStorage.setItem("noaide-github-repo", repo());
              fetchIssues(repo());
            }
          }}
          style={{
            flex: "1", padding: "6px 8px", background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)", "border-radius": "4px",
            color: "var(--ctp-text)", "font-size": "11px", outline: "none",
          }}
        />
        <button
          onClick={() => { localStorage.setItem("noaide-github-repo", repo()); fetchIssues(repo()); }}
          style={{
            padding: "6px 12px", background: "var(--ctp-blue)", color: "var(--ctp-base)",
            border: "none", "border-radius": "4px", "font-size": "11px", cursor: "pointer",
          }}
        >
          Fetch
        </button>
      </div>
      <Show when={loading()}>
        <div style={{ color: "var(--ctp-overlay0)", "font-size": "11px" }}>Loading issues...</div>
      </Show>
      <Show when={!loading() && issues().length === 0 && repo()}>
        <div style={{ color: "var(--ctp-overlay0)", "font-size": "11px" }}>No issues found or CORS blocked. Try a public repo.</div>
      </Show>
      <For each={issues()}>
        {(issue) => (
          <div
            data-testid={`github-issue-${issue.number}`}
            style={{
              display: "flex", "align-items": "center", gap: "8px",
              padding: "6px 8px", "border-bottom": "1px solid var(--ctp-surface0)",
              "font-size": "11px",
            }}
          >
            <span style={{
              width: "8px", height: "8px", "border-radius": "50%", "flex-shrink": "0",
              background: issue.state === "open" ? "var(--ctp-green)" : "var(--ctp-red)",
            }} />
            <span style={{ color: "var(--ctp-overlay0)", "flex-shrink": "0" }}>#{issue.number}</span>
            <span style={{ flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", color: "var(--ctp-text)" }}>
              {issue.title}
            </span>
            <For each={issue.labels.slice(0, 3)}>
              {(label) => (
                <span style={{
                  "font-size": "9px", padding: "1px 5px", "border-radius": "3px",
                  background: "var(--ctp-surface1)", color: "var(--ctp-subtext0)",
                }}>
                  {label}
                </span>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
