// ============================================================
// KanbanBoard — 6-column WP board with WIP limits + DnD
// Design: matches plan-noaide.html Kanban styling
// ============================================================

import { type Component, For, createMemo, createSignal } from "solid-js";
import { usePlan } from "../stores/planProvider";
import type { WPStatus, WorkPackage } from "../types/plan";

interface ColumnDef {
  id: WPStatus;
  label: string;
  color: string;
}

const COLUMNS: ColumnDef[] = [
  { id: "backlog", label: "Backlog", color: "var(--overlay0)" },
  { id: "analysis", label: "Analysis", color: "var(--mauve)" },
  { id: "ready", label: "Ready", color: "var(--blue)" },
  { id: "in_progress", label: "In Progress", color: "var(--yellow)" },
  { id: "review", label: "Review", color: "var(--peach)" },
  { id: "done", label: "Done", color: "var(--green)" },
];

export const KanbanBoard: Component = () => {
  const store = usePlan();
  const [draggedWP, setDraggedWP] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<WPStatus | null>(null);

  const wpByColumn = createMemo(() => {
    const groups: Record<WPStatus, WorkPackage[]> = {
      backlog: [], analysis: [], ready: [],
      in_progress: [], review: [], done: [],
    };
    for (const wp of store.plan.work_packages) {
      groups[wp.status]?.push(wp);
    }
    return groups;
  });

  const wipLimit = () => store.plan.meta.wip_limit;

  const handleDrop = (targetColumn: WPStatus) => {
    const wpId = draggedWP();
    if (!wpId) return;
    store.setWPStatus(wpId, targetColumn);
    setDraggedWP(null);
    setDropTarget(null);
  };

  return (
    <div class="section">
      <div class="section-header">
        <span class="section-icon">&#9638;</span>
        <h2>Kanban Board</h2>
      </div>
      <div class="section-body">
        <div class="kanban-board">
          <For each={COLUMNS}>
            {(col) => {
              const cards = () => wpByColumn()[col.id] ?? [];
              const isOverWip = () => col.id === "in_progress" && cards().length > wipLimit();
              const isDropHere = () => dropTarget() === col.id;

              return (
                <div
                  class="kanban-col"
                  onDragOver={(e) => { e.preventDefault(); setDropTarget(col.id); }}
                  onDragLeave={() => { if (dropTarget() === col.id) setDropTarget(null); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(col.id); }}
                  style={{
                    outline: isDropHere() ? `2px dashed ${col.color}` : "none",
                    background: isDropHere() ? "var(--bg-hover)" : undefined,
                  }}
                >
                  <div class="kanban-col-header">
                    <span style={{ color: col.color }}>{col.label}</span>
                    <span class="wip" style={{
                      color: isOverWip() ? "var(--red)" : undefined,
                      "font-weight": isOverWip() ? "700" : undefined,
                    }}>
                      {" "}{cards().length}
                      {col.id === "in_progress" && `/${wipLimit()}`}
                    </span>
                  </div>

                  {isOverWip() && (
                    <div style={{
                      background: "var(--red)", color: "white",
                      "font-size": "0.65rem", "font-weight": "700",
                      "text-align": "center", padding: "2px",
                    }}>
                      WIP LIMIT
                    </div>
                  )}

                  <div class="kanban-cards">
                    <For each={cards()}>
                      {(wp) => (
                        <WPCard
                          wp={wp}
                          isDragging={draggedWP() === wp.id}
                          onDragStart={() => setDraggedWP(wp.id)}
                          onDragEnd={() => { setDraggedWP(null); setDropTarget(null); }}
                        />
                      )}
                    </For>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};

interface WPCardProps {
  wp: WorkPackage;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}

const WPCard: Component<WPCardProps> = (props) => {
  const verifyDone = () => props.wp.verify_checks.filter((c) => c.passed).length;
  const verifyTotal = () => props.wp.verify_checks.length;
  const sizeClass = () => `kanban-card size-${props.wp.size.toLowerCase()}`;

  return (
    <div
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("text/plain", props.wp.id);
        props.onDragStart();
      }}
      onDragEnd={() => props.onDragEnd()}
      class={`${sizeClass()} ${props.isDragging ? "dragging" : ""}`}
    >
      <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "2px" }}>
        <span style={{ "font-weight": "700", color: "var(--blue)", "font-size": "0.85em" }}>
          {props.wp.id}
        </span>
        <span class={`badge badge-${props.wp.size === "S" ? "green" : props.wp.size === "M" ? "blue" : "peach"}`}
              style={{ "font-size": "0.6rem", padding: "0 5px" }}>
          {props.wp.size}
        </span>
      </div>
      <div style={{ color: "var(--text-primary)", "margin-bottom": "3px" }}>{props.wp.title}</div>
      <div style={{ display: "flex", "justify-content": "space-between", "font-size": "0.9em", color: "var(--text-muted)" }}>
        {verifyTotal() > 0 && (
          <span style={{ color: verifyDone() === verifyTotal() ? "var(--green)" : undefined }}>
            {verifyDone()}/{verifyTotal()} verified
          </span>
        )}
        {props.wp.gate_required && <span style={{ color: "var(--yellow)" }}>Gate</span>}
      </div>
      {props.wp.dependencies.length > 0 && (
        <div class="wp-deps">blocked by: {props.wp.dependencies.join(", ")}</div>
      )}
    </div>
  );
};
