// ============================================================
// DependencyGraph — SVG DAG with dagre auto-layout
// ============================================================

import { type Component, createMemo, For } from "solid-js";
import { usePlan } from "../stores/planProvider";
import dagre from "@dagrejs/dagre";

const STATUS_COLORS: Record<string, string> = {
  backlog: "var(--overlay0)",
  analysis: "var(--mauve)",
  ready: "var(--blue)",
  in_progress: "var(--yellow)",
  review: "var(--peach)",
  done: "var(--green)",
};

interface LayoutNode {
  id: string;
  title: string;
  status: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isCritical: boolean;
}

interface LayoutEdge {
  from: string;
  to: string;
  points: Array<{ x: number; y: number }>;
  isCritical: boolean;
}

export const DependencyGraph: Component = () => {
  const store = usePlan();

  const layout = createMemo(() => {
    const wps = store.plan.work_packages ?? [];
    const depGraph = store.plan.dependency_graph;
    const criticalPath = new Set(depGraph?.critical_path ?? []);

    // Build dagre graph
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "LR",
      nodesep: 40,
      ranksep: 80,
      marginx: 30,
      marginy: 30,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    const nodeWidth = 140;
    const nodeHeight = 50;
    for (const wp of wps) {
      g.setNode(wp.id, { width: nodeWidth, height: nodeHeight });
    }

    // Add edges from dependency_graph or wp.dependencies
    const edgeSet = new Set<string>();
    if (depGraph?.edges?.length) {
      for (const edge of depGraph.edges) {
        const key = `${edge.from}->${edge.to}`;
        if (!edgeSet.has(key)) {
          g.setEdge(edge.from, edge.to);
          edgeSet.add(key);
        }
      }
    } else {
      // Fallback: derive from wp.dependencies
      for (const wp of wps) {
        for (const dep of wp.dependencies) {
          const key = `${dep}->${wp.id}`;
          if (!edgeSet.has(key)) {
            g.setEdge(dep, wp.id);
            edgeSet.add(key);
          }
        }
      }
    }

    dagre.layout(g);

    // Extract positioned nodes
    const wpMap = new Map(wps.map((wp) => [wp.id, wp]));
    const nodes: LayoutNode[] = g.nodes().map((id) => {
      const node = g.node(id);
      const wp = wpMap.get(id);
      return {
        id,
        title: wp?.title ?? id,
        status: wp?.status ?? "backlog",
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        isCritical: criticalPath.has(id),
      };
    });

    // Extract edges with points
    const edges: LayoutEdge[] = g.edges().map((e) => {
      const edge = g.edge(e);
      return {
        from: e.v,
        to: e.w,
        points: edge.points ?? [],
        isCritical: criticalPath.has(e.v) && criticalPath.has(e.w),
      };
    });

    // Calculate SVG bounds
    const graphInfo = g.graph();
    const svgWidth = (graphInfo.width ?? 800) + 60;
    const svgHeight = (graphInfo.height ?? 400) + 60;

    return { nodes, edges, svgWidth, svgHeight };
  });

  return (
    <div class="section">
      <div class="section-header" style={{ cursor: "default" }}>
        <span class="section-icon">&#128279;</span>
        <h2>Dependency Graph ({layout().nodes.length} WPs, {layout().edges.length} edges)</h2>
      </div>
      <div class="section-body">
        <div style={{ overflow: "auto", background: "var(--bg-primary)", "border-radius": "var(--radius)" }}>
          <svg
            viewBox={`0 0 ${layout().svgWidth} ${layout().svgHeight}`}
            width={layout().svgWidth}
            height={layout().svgHeight}
            style={{ "min-width": "100%" }}
          >
            <defs>
              <marker
                id="dep-arrow"
                viewBox="0 0 10 10"
                refX="10" refY="5"
                markerWidth="8" markerHeight="8"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--overlay1)" />
              </marker>
              <marker
                id="dep-arrow-critical"
                viewBox="0 0 10 10"
                refX="10" refY="5"
                markerWidth="8" markerHeight="8"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--red)" />
              </marker>
            </defs>

            {/* Edges */}
            <For each={layout().edges}>
              {(edge) => {
                const pts = edge.points;
                if (pts.length < 2) return null;
                const d = `M ${pts[0].x} ${pts[0].y} ` +
                  pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");
                return (
                  <path
                    d={d}
                    fill="none"
                    stroke={edge.isCritical ? "var(--red)" : "var(--surface2)"}
                    stroke-width={edge.isCritical ? 2.5 : 1.5}
                    marker-end={edge.isCritical ? "url(#dep-arrow-critical)" : "url(#dep-arrow)"}
                  />
                );
              }}
            </For>

            {/* Nodes */}
            <For each={layout().nodes}>
              {(node) => {
                const color = STATUS_COLORS[node.status] ?? "var(--overlay0)";
                return (
                  <g style={{ cursor: "pointer" }}>
                    {/* Critical path highlight */}
                    {node.isCritical && (
                      <rect
                        x={node.x - node.width / 2 - 3}
                        y={node.y - node.height / 2 - 3}
                        width={node.width + 6}
                        height={node.height + 6}
                        rx="8"
                        fill="none"
                        stroke="var(--red)"
                        stroke-width="2"
                        stroke-dasharray="4 2"
                      />
                    )}

                    {/* Node rect */}
                    <rect
                      x={node.x - node.width / 2}
                      y={node.y - node.height / 2}
                      width={node.width}
                      height={node.height}
                      rx="6"
                      fill="var(--bg-card)"
                      stroke={color}
                      stroke-width="2"
                    />

                    {/* WP ID */}
                    <text
                      x={node.x}
                      y={node.y - 8}
                      text-anchor="middle"
                      dominant-baseline="middle"
                      fill={color}
                      font-size="12"
                      font-weight="700"
                    >
                      {node.id}
                    </text>

                    {/* Title (truncated) */}
                    <text
                      x={node.x}
                      y={node.y + 10}
                      text-anchor="middle"
                      dominant-baseline="middle"
                      fill="var(--text-muted)"
                      font-size="9"
                    >
                      {node.title.length > 18
                        ? node.title.substring(0, 16) + "..."
                        : node.title}
                    </text>
                  </g>
                );
              }}
            </For>
          </svg>
        </div>

        {/* Legend */}
        <div style={{
          display: "flex",
          gap: "16px",
          "margin-top": "0.75rem",
          "font-size": "0.8em",
          color: "var(--text-muted)",
          "flex-wrap": "wrap",
        }}>
          <span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
            <span style={{
              width: "24px", height: "3px",
              background: "var(--red)", display: "inline-block",
            }} />
            Critical Path
          </span>
          <For each={Object.entries(STATUS_COLORS)}>
            {([status, color]) => (
              <span style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                <span style={{
                  width: "10px", height: "10px", "border-radius": "2px",
                  background: color, display: "inline-block",
                }} />
                {status.replace("_", " ")}
              </span>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
