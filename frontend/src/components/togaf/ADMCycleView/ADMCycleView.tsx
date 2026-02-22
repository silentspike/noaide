// ============================================================
// ADMCycleView — SVG circular ADM phase diagram
// ============================================================

import { type Component, For, createMemo } from "solid-js";
import { usePlan } from "../stores/planProvider";
import { TOGAF_PHASES } from "../types/togafPhases";
import type { SectionId } from "../types/plan";

/** Phases arranged clockwise in the ADM circle (excluding RM) */
const CYCLE_PHASES = TOGAF_PHASES.filter((p) => p.id !== "req_mgmt");
const RM_PHASE = TOGAF_PHASES.find((p) => p.id === "req_mgmt");

const PHASE_COLORS: Record<string, string> = {
  green: "var(--green)", blue: "var(--blue)", teal: "var(--teal)",
  sapphire: "var(--sapphire)", lavender: "var(--lavender)", peach: "var(--peach)",
  yellow: "var(--yellow)", flamingo: "var(--flamingo)", pink: "var(--pink)",
  mauve: "var(--mauve)", red: "var(--red)", rosewater: "var(--rosewater)",
};

type PhaseStatus = "done" | "in_progress" | "pending";

export const ADMCycleView: Component = () => {
  const store = usePlan();

  const phaseStatus = createMemo(() => {
    const result: Record<string, PhaseStatus> = {};
    for (const phase of TOGAF_PHASES) {
      const sectionStatuses = phase.sections.map(
        (s) => store.plan.sections[s.id as SectionId]?.status ?? "pending"
      );
      const allDone = sectionStatuses.every((s) => s === "done" || s === "skipped");
      const anyInProgress = sectionStatuses.some((s) => s === "in_progress");
      const anyDone = sectionStatuses.some((s) => s === "done");
      result[phase.id] = allDone ? "done" : anyInProgress || anyDone ? "in_progress" : "pending";
    }
    return result;
  });

  const cx = 320;
  const cy = 260;
  const radius = 170;

  return (
    <div class="section">
      <div class="section-header" style={{ cursor: "default" }}>
        <span class="section-icon">&#9673;</span>
        <h2>ADM Cycle</h2>
      </div>
      <div class="section-body">
        <svg
          viewBox="0 0 640 570"
          width="100%"
          style={{ "max-height": "520px" }}
        >
          {/* Connection arcs between phases */}
          <For each={CYCLE_PHASES}>
            {(_phase, i) => {
              /* eslint-disable solid/reactivity -- index accessor stable in For callback */
              const nextIdx = (i() + 1) % CYCLE_PHASES.length;
              const angle1 = -90 + (i() * 360) / CYCLE_PHASES.length;
              const angle2 = -90 + (nextIdx * 360) / CYCLE_PHASES.length;
              const rad1 = (angle1 * Math.PI) / 180;
              const rad2 = (angle2 * Math.PI) / 180;
              const x1 = cx + radius * Math.cos(rad1);
              const y1 = cy + radius * Math.sin(rad1);
              const x2 = cx + radius * Math.cos(rad2);
              const y2 = cy + radius * Math.sin(rad2);

              return (
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="var(--surface1)"
                  stroke-width="1.5"
                  stroke-dasharray="4 3"
                />
              );
              /* eslint-enable solid/reactivity */
            }}
          </For>

          {/* Phase nodes around the circle */}
          <For each={CYCLE_PHASES}>
            {(phase, i) => {
              // eslint-disable-next-line solid/reactivity -- index stable in For callback
              const angle = -90 + (i() * 360) / CYCLE_PHASES.length;
              const rad = (angle * Math.PI) / 180;
              const x = cx + radius * Math.cos(rad);
              const y = cy + radius * Math.sin(rad);
              const status = () => phaseStatus()[phase.id] ?? "pending";
              const nodeRadius = 32;
              const color = PHASE_COLORS[phase.color] ?? "var(--overlay0)";

              return (
                <g>
                  {/* Glow for done */}
                  {status() === "done" && (
                    <circle
                      cx={x} cy={y} r={nodeRadius + 4}
                      fill="none"
                      stroke={color}
                      stroke-width="2"
                      opacity="0.3"
                    />
                  )}

                  {/* Node circle */}
                  <circle
                    cx={x} cy={y} r={nodeRadius}
                    fill={
                      status() === "done"
                        ? color
                        : status() === "in_progress"
                          ? "var(--surface1)"
                          : "var(--surface0)"
                    }
                    stroke={color}
                    stroke-width={status() === "pending" ? "1.5" : "2.5"}
                    style={{ cursor: "pointer" }}
                  />

                  {/* Phase code label */}
                  <text
                    x={x} y={y - 4}
                    text-anchor="middle"
                    dominant-baseline="middle"
                    fill={
                      status() === "done"
                        ? "var(--crust)"
                        : "var(--text-primary)"
                    }
                    font-size="16"
                    font-weight="700"
                  >
                    {phase.code}
                  </text>

                  {/* Status indicator */}
                  <text
                    x={x} y={y + 14}
                    text-anchor="middle"
                    dominant-baseline="middle"
                    fill={
                      status() === "done"
                        ? "var(--crust)"
                        : "var(--text-muted)"
                    }
                    font-size="8"
                    font-weight="600"
                  >
                    {status() === "done" ? "DONE" : status() === "in_progress" ? "WIP" : ""}
                  </text>

                  {/* Phase name outside the circle */}
                  <text
                    x={x + (x > cx ? 6 : x < cx ? -6 : 0) + (nodeRadius + 8) * Math.cos(rad)}
                    y={y + (nodeRadius + 8) * Math.sin(rad)}
                    text-anchor={x > cx + 10 ? "start" : x < cx - 10 ? "end" : "middle"}
                    dominant-baseline={y > cy + 10 ? "hanging" : y < cy - 10 ? "auto" : "middle"}
                    fill="var(--text-muted)"
                    font-size="10"
                    font-weight="500"
                  >
                    {phase.name.replace(/^Phase [A-H]: /, "")}
                  </text>
                </g>
              );
            }}
          </For>

          {/* Requirements Management — center */}
          {RM_PHASE && (() => {
            const status = () => phaseStatus()[RM_PHASE!.id] ?? "pending";
            const color = PHASE_COLORS[RM_PHASE!.color] ?? "var(--mauve)";
            return (
              <g>
                <circle
                  cx={cx} cy={cy} r={48}
                  fill={
                    status() === "done"
                      ? color
                      : "var(--surface0)"
                  }
                  stroke={color}
                  stroke-width="2.5"
                />
                <text
                  x={cx} y={cy - 8}
                  text-anchor="middle"
                  dominant-baseline="middle"
                  fill={status() === "done" ? "var(--crust)" : "var(--text-primary)"}
                  font-size="11"
                  font-weight="700"
                >
                  RM
                </text>
                <text
                  x={cx} y={cy + 8}
                  text-anchor="middle"
                  dominant-baseline="middle"
                  fill={status() === "done" ? "var(--crust)" : "var(--text-muted)"}
                  font-size="8"
                >
                  Requirements
                </text>
                <text
                  x={cx} y={cy + 18}
                  text-anchor="middle"
                  dominant-baseline="middle"
                  fill={status() === "done" ? "var(--crust)" : "var(--text-muted)"}
                  font-size="8"
                >
                  Management
                </text>
              </g>
            );
          })()}

          {/* Directional arrows (small triangles on connection lines) */}
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="5" refY="5"
              markerWidth="6" markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--surface2)" />
            </marker>
          </defs>
        </svg>

        {/* Legend */}
        <div style={{
          display: "flex",
          "justify-content": "center",
          gap: "24px",
          "font-size": "0.8em",
          color: "var(--text-muted)",
          padding: "0.5rem 0",
        }}>
          <span style={{ display: "flex", "align-items": "center", gap: "6px" }}>
            <span style={{
              width: "12px", height: "12px", "border-radius": "50%",
              background: "var(--green)", display: "inline-block",
            }} />
            Done
          </span>
          <span style={{ display: "flex", "align-items": "center", gap: "6px" }}>
            <span style={{
              width: "12px", height: "12px", "border-radius": "50%",
              background: "var(--surface1)",
              border: "2px solid var(--yellow)",
              display: "inline-block",
            }} />
            In Progress
          </span>
          <span style={{ display: "flex", "align-items": "center", gap: "6px" }}>
            <span style={{
              width: "12px", height: "12px", "border-radius": "50%",
              background: "var(--surface0)",
              border: "1px solid var(--overlay0)",
              display: "inline-block",
            }} />
            Pending
          </span>
        </div>
      </div>
    </div>
  );
};
