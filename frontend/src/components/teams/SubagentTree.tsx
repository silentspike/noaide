import { createMemo, For, Show } from "solid-js";
import type { ChatMessage } from "../../types/messages";

interface TreeNode {
  id: string;
  label: string;
  role: string;
  model?: string;
  messageCount: number;
  tokenCount: number;
  cost: number;
  isSidechain: boolean;
  children: TreeNode[];
  depth: number;
}

interface SubagentTreeProps {
  messages: ChatMessage[];
}

export default function SubagentTree(props: SubagentTreeProps) {
  const tree = createMemo(() => buildTree(props.messages));
  const stats = createMemo(() => {
    const t = tree();
    const agentCount = countNodes(t) - 1; // exclude root
    return { agentCount, roots: t };
  });

  return (
    <div
      style={{
        padding: "12px",
        "font-size": "12px",
        color: "var(--ctp-text)",
        height: "100%",
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "margin-bottom": "12px",
        }}
      >
        <span
          style={{
            "font-size": "13px",
            "font-weight": "700",
            "font-family": "var(--font-mono)",
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
            color: "var(--neon-purple, #a855f7)",
          }}
        >
          Subagent Tree
        </span>
        <Show when={stats().agentCount > 0}>
          <span
            style={{
              "font-size": "10px",
              "font-family": "var(--font-mono)",
              color: "var(--ctp-subtext0)",
              padding: "1px 6px",
              background: "rgba(168,85,247,0.08)",
              "border-radius": "4px",
            }}
          >
            {stats().agentCount} subagent{stats().agentCount !== 1 ? "s" : ""}
          </span>
        </Show>
      </div>

      <Show
        when={stats().roots.length > 0}
        fallback={
          <div
            style={{
              color: "var(--ctp-overlay1)",
              "font-size": "11px",
              "text-align": "center",
              padding: "24px",
            }}
          >
            No subagent activity in this session
          </div>
        }
      >
        <For each={stats().roots}>
          {(node) => <TreeNodeView node={node} />}
        </For>
      </Show>
    </div>
  );
}

function TreeNodeView(props: { node: TreeNode }) {
  const n = () => props.node;
  const hasChildren = () => n().children.length > 0;
  const indent = () => n().depth * 20;

  const nodeColor = () => {
    if (n().isSidechain) return "var(--ctp-overlay1)";
    if (n().depth === 0) return "var(--neon-green, #00ff9d)";
    return "var(--neon-blue, #00b8ff)";
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "4px 8px",
          "padding-left": `${indent() + 8}px`,
          "border-radius": "4px",
          transition: "background 100ms ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
        }}
      >
        {/* Connector lines */}
        <Show when={n().depth > 0}>
          <span
            style={{
              color: "var(--ctp-surface2)",
              "font-size": "10px",
              "font-family": "var(--font-mono)",
              "flex-shrink": "0",
            }}
          >
            {hasChildren() ? "\u251C\u2500\u252C" : "\u251C\u2500\u2500"}
          </span>
        </Show>

        {/* Node dot */}
        <span
          style={{
            width: "8px",
            height: "8px",
            "border-radius": "50%",
            background: nodeColor(),
            "flex-shrink": "0",
            "box-shadow": `0 0 6px ${nodeColor()}40`,
          }}
        />

        {/* Label */}
        <span
          style={{
            "font-weight": "600",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            color: nodeColor(),
            "min-width": "0",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {n().label}
        </span>

        {/* Model badge */}
        <Show when={n().model}>
          <span
            style={{
              "font-size": "9px",
              "font-family": "var(--font-mono)",
              padding: "1px 5px",
              "border-radius": "3px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--ctp-surface0)",
              color: "var(--ctp-overlay1)",
              "flex-shrink": "0",
            }}
          >
            {shortModel(n().model!)}
          </span>
        </Show>

        {/* Stats */}
        <div
          style={{
            "margin-left": "auto",
            display: "flex",
            gap: "8px",
            "flex-shrink": "0",
            "font-size": "9px",
            "font-family": "var(--font-mono)",
            color: "var(--ctp-overlay0)",
          }}
        >
          <span>{n().messageCount} msg</span>
          <Show when={n().tokenCount > 0}>
            <span>{formatTokens(n().tokenCount)}</span>
          </Show>
          <Show when={n().cost > 0}>
            <span style={{ color: costColor(n().cost) }}>
              ${n().cost.toFixed(4)}
            </span>
          </Show>
        </div>

        {/* Sidechain indicator */}
        <Show when={n().isSidechain}>
          <span
            style={{
              "font-size": "8px",
              "font-weight": "700",
              "font-family": "var(--font-mono)",
              padding: "1px 4px",
              "border-radius": "3px",
              background: "rgba(243,139,168,0.08)",
              color: "var(--ctp-red)",
              "flex-shrink": "0",
            }}
          >
            SIDE
          </span>
        </Show>
      </div>

      {/* Children */}
      <For each={n().children}>
        {(child) => <TreeNodeView node={child} />}
      </For>
    </div>
  );
}

// ── Tree building ───────────────────────────────────────

function buildTree(messages: ChatMessage[]): TreeNode[] {
  // Group messages by agentId
  const agentMessages = new Map<string, ChatMessage[]>();
  const rootMessages: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.agentId) {
      let arr = agentMessages.get(msg.agentId);
      if (!arr) {
        arr = [];
        agentMessages.set(msg.agentId, arr);
      }
      arr.push(msg);
    } else {
      rootMessages.push(msg);
    }
  }

  // If no agents, just return root
  if (agentMessages.size === 0) {
    if (rootMessages.length === 0) return [];
    return [makeNode("main", rootMessages, 0)];
  }

  // Build root node
  const root = makeNode("main", rootMessages, 0);

  // Build agent nodes as children of root
  // In Claude Code, subagents have agentId, and their parentUuid links to the main thread
  for (const [agentId, msgs] of agentMessages) {
    const node = makeNode(agentId, msgs, 1);
    root.children.push(node);
  }

  // Sort children by first message timestamp
  root.children.sort((a, b) => {
    const aFirst = props_firstTs(a);
    const bFirst = props_firstTs(b);
    return aFirst - bFirst;
  });

  return [root];
}

function makeNode(id: string, messages: ChatMessage[], depth: number): TreeNode {
  let tokenCount = 0;
  let cost = 0;
  let model: string | undefined;
  let isSidechain = false;

  for (const msg of messages) {
    tokenCount += (msg.inputTokens ?? 0) + (msg.outputTokens ?? 0);
    cost += msg.costUsd ?? 0;
    if (msg.model && !model) model = msg.model;
    if (msg.isSidechain) isSidechain = true;
  }

  return {
    id,
    label: id === "main" ? "Main Thread" : truncateId(id),
    role: "agent",
    model,
    messageCount: messages.length,
    tokenCount,
    cost,
    isSidechain,
    children: [],
    depth,
  };
}

function props_firstTs(node: TreeNode): number {
  // Approximation — nodes don't store timestamps directly, use sort order
  return 0;
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return id.slice(0, 8) + "...";
}

function shortModel(model: string): string {
  const parts = model.split("-");
  if (parts.length >= 2) return parts.slice(0, 2).join("-");
  return model.slice(0, 16);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function costColor(cost: number): string {
  if (cost < 0.01) return "var(--neon-green, #00ff9d)";
  if (cost < 0.1) return "var(--accent-gold, #f59e0b)";
  return "var(--accent-red, #ff4444)";
}

function countNodes(nodes: TreeNode[]): number {
  let count = nodes.length;
  for (const n of nodes) count += countNodes(n.children);
  return count;
}
