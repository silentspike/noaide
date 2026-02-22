// ============================================================
// MasterChecklist — Phase-grouped checklist (template design)
// ============================================================

import { type Component, For, Show, createMemo } from "solid-js";
import { usePlan } from "../stores/planProvider";
import { TOGAF_PHASES, shouldShowSection } from "../types/togafPhases";
import type { SectionId, SectionStatus, TailoringLevel } from "../types/plan";
import { SectionCard as _SectionCard } from "../SectionCard";
import { GateIndicator as _GateIndicator } from "../GateIndicator";

const PHASE_COLORS: Record<string, string> = {
  green: "var(--green)", blue: "var(--blue)", teal: "var(--teal)",
  sapphire: "var(--sapphire)", lavender: "var(--lavender)", peach: "var(--peach)",
  yellow: "var(--yellow)", pink: "var(--pink)", red: "var(--red)", mauve: "var(--mauve)",
};

interface Props {
  filter?: string;
}

export const MasterChecklist: Component<Props> = (props) => {
  const store = usePlan();

  const filteredPhases = createMemo(() => {
    const level = store.plan.meta.tailoring as TailoringLevel;
    const q = (props.filter ?? "").toLowerCase();

    return TOGAF_PHASES.map((phase) => {
      const sections = phase.sections.filter((s) => {
        if (!shouldShowSection(s, level)) return false;
        if (q && !s.name.toLowerCase().includes(q) && !s.id.includes(q)) return false;
        return true;
      });
      return { ...phase, sections };
    }).filter((p) => p.sections.length > 0);
  });

  function phaseDone(phaseId: string): number {
    const phase = TOGAF_PHASES.find((p) => p.id === phaseId);
    if (!phase) return 0;
    return phase.sections.filter((s) => {
      const data = store.plan.sections[s.id as SectionId];
      return data?.status === "done";
    }).length;
  }

  function phaseTotal(phaseId: string): number {
    const phase = TOGAF_PHASES.find((p) => p.id === phaseId);
    return phase?.sections.length ?? 0;
  }

  function handleStatusChange(id: SectionId, status: SectionStatus) {
    store.setSectionStatus(id, status);
  }

  return (
    <div class="section">
      <div class="section-header" style={{ cursor: "default" }}>
        <span class="section-icon">&#9745;</span>
        <h2>Master-Checkliste (TOGAF ADM)</h2>
      </div>
      <div class="section-body">
        <div style={{
          display: "grid",
          "grid-template-columns": "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "1rem",
        }}>
          <For each={filteredPhases()}>
            {(phase) => (
              <div>
                <h4 style={{
                  "margin-bottom": "0.5rem",
                  color: PHASE_COLORS[phase.color] || "var(--text-primary)",
                }}>
                  {phase.name}
                  <span style={{
                    "font-size": "0.75rem", "font-weight": "400",
                    color: "var(--text-muted)", "margin-left": "0.5rem",
                  }}>
                    {phaseDone(phase.id)}/{phaseTotal(phase.id)}
                  </span>
                </h4>
                <ul class="checklist">
                  <For each={phase.sections}>
                    {(section) => {
                      const data = () =>
                        store.plan.sections[section.id as SectionId];
                      const isDone = () => data()?.status === "done";
                      const isSkipped = () => data()?.status === "skipped";

                      return (
                        <li style={{
                          opacity: isSkipped() ? "0.5" : "1",
                        }}>
                          <span class={`check-icon ${isDone() ? "check-pass" : "check-open"}`}>
                            {isDone() ? "\u2713" : "\u25CB"}
                          </span>
                          <span onClick={() => handleStatusChange(
                            section.id as SectionId,
                            isDone() ? "pending" : "done"
                          )}
                          style={{ cursor: "pointer" }}>
                            {section.id.toUpperCase().replace(/(\d)/, ".$1")} {section.name}
                          </span>
                        </li>
                      );
                    }}
                  </For>
                </ul>
                <Show when={phase.gate !== undefined}>
                  <li class="check-gate" style={{ "list-style": "none", "margin-top": "0.3rem" }}>
                    <span class={`check-icon ${store.plan.gates[phase.gate!] === "pass" ? "check-pass" : "check-open"}`}>
                      {store.plan.gates[phase.gate!] === "pass" ? "\u2713" : "\u25CB"}
                    </span>
                    GATE {phase.gate} {store.plan.gates[phase.gate!] === "pass" ? "bestanden" : "ausstehend"}
                  </li>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
