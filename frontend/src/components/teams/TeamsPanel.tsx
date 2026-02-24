import { createSignal, Show } from "solid-js";
import TopologyGraph from "./TopologyGraph";
import SwimlaneTL, { type SwimlaneBlock } from "./SwimlaneTL";
import type { AgentInfo } from "./AgentCard";

type ViewMode = "topology" | "swimlane";

export default function TeamsPanel() {
  const [viewMode, setViewMode] = createSignal<ViewMode>("topology");

  // Demo data — will be replaced by real data from WebTransport
  const agents: AgentInfo[] = [
    { name: "team-lead", agentId: "abc-001", agentType: "general-purpose", isLeader: true, status: "active", messageCount: 12 },
    { name: "researcher", agentId: "abc-002", agentType: "Explore", isLeader: false, status: "active", messageCount: 5, currentTask: "Search for API patterns" },
    { name: "implementer", agentId: "abc-003", agentType: "general-purpose", isLeader: false, status: "idle", messageCount: 8 },
    { name: "tester", agentId: "abc-004", agentType: "Bash", isLeader: false, status: "idle", messageCount: 3 },
  ];

  const edges = [
    { from: "team-lead", to: "researcher" },
    { from: "team-lead", to: "implementer" },
    { from: "team-lead", to: "tester" },
  ];

  const messages = [
    { id: "msg-1", from: "team-lead", to: "researcher", progress: 0.3 },
    { id: "msg-2", from: "team-lead", to: "implementer", progress: 0.7 },
  ];

  const swimlaneBlocks: SwimlaneBlock[] = [
    { agentName: "team-lead", startMs: 0, endMs: 5000, state: "active", label: "Planning" },
    { agentName: "team-lead", startMs: 5000, endMs: 8000, state: "thinking" },
    { agentName: "team-lead", startMs: 8000, endMs: 15000, state: "idle" },
    { agentName: "team-lead", startMs: 15000, endMs: 20000, state: "active", label: "Review" },
    { agentName: "researcher", startMs: 5000, endMs: 7000, state: "idle" },
    { agentName: "researcher", startMs: 7000, endMs: 14000, state: "active", label: "Search APIs" },
    { agentName: "researcher", startMs: 14000, endMs: 16000, state: "tool_use", label: "WebFetch" },
    { agentName: "implementer", startMs: 8000, endMs: 10000, state: "thinking" },
    { agentName: "implementer", startMs: 10000, endMs: 18000, state: "active", label: "Write code" },
    { agentName: "implementer", startMs: 18000, endMs: 20000, state: "tool_use", label: "Edit files" },
    { agentName: "tester", startMs: 16000, endMs: 17000, state: "idle" },
    { agentName: "tester", startMs: 17000, endMs: 20000, state: "active", label: "Run tests" },
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
          {agents.length} agents
        </span>
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
        <Show when={viewMode() === "topology"}>
          <TopologyGraph agents={agents} edges={edges} messages={messages} />
        </Show>
        <Show when={viewMode() === "swimlane"}>
          <div style={{ padding: "8px" }}>
            <SwimlaneTL
              agents={agents.map((a) => a.name)}
              blocks={swimlaneBlocks}
              totalDurationMs={22000}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
