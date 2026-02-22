// ============================================================
// TOGAFDashboard — Root Component (Enterprise Design)
// Layout: CSS Grid — Header | Sidebar + Main Content
// Matches plan-noaide.html reference design
// ============================================================

import {
  type Component,
  createSignal,
  Show,
  For,
} from "solid-js";
import { usePlan } from "./stores/planProvider";
import { TOGAF_PHASES } from "./types/togafPhases";
import type { SectionId } from "./types/plan";
import LiveIndicator from "./controls/LiveIndicator";
import ThemeToggle from "./controls/ThemeToggle";
import SearchFilter from "./controls/SearchFilter";
import { MasterChecklist } from "./MasterChecklist";
import { KanbanBoard } from "./KanbanBoard";
import { RiskMatrix } from "./RiskMatrix";
import { WorkPackageGrid } from "./WorkPackageGrid";
import { ADRTable } from "./ADRTable";
import { RequirementsTable } from "./RequirementsTable";
import { ADMCycleView } from "./ADMCycleView";
import { DependencyGraph } from "./DependencyGraph";

type ViewId = "checklist" | "kanban" | "risks" | "workpackages" | "adrs" | "requirements" | "adm" | "dependencies";

interface ViewDef {
  id: ViewId;
  label: string;
  icon: string;
}

const VIEWS: ViewDef[] = [
  { id: "adm", label: "ADM Cycle", icon: "\u25C9" },
  { id: "checklist", label: "Master-Checkliste", icon: "\u2611" },
  { id: "kanban", label: "Kanban Board", icon: "\u2630" },
  { id: "risks", label: "Risk Assessment", icon: "\u26A0" },
  { id: "workpackages", label: "Work Packages", icon: "\uD83D\uDCE6" },
  { id: "adrs", label: "ADRs", icon: "\uD83D\uDCDD" },
  { id: "requirements", label: "Requirements", icon: "\uD83D\uDCCB" },
  { id: "dependencies", label: "Dependency Graph", icon: "\uD83D\uDD17" },
];

/** Map phase color names to CSS var names */
const PHASE_COLORS: Record<string, string> = {
  green: "var(--green)", blue: "var(--blue)", teal: "var(--teal)",
  sapphire: "var(--sapphire)", lavender: "var(--lavender)", peach: "var(--peach)",
  yellow: "var(--yellow)", pink: "var(--pink)", red: "var(--red)", mauve: "var(--mauve)",
};

/** Badge class from status */
function statusBadgeClass(status: string): string {
  switch (status) {
    case "Draft": return "badge badge-peach";
    case "In Progress": return "badge badge-blue";
    case "Review": return "badge badge-yellow";
    case "Final": return "badge badge-green";
    default: return "badge badge-peach";
  }
}

const TOGAFDashboard: Component = () => {
  const store = usePlan();
  const [activeView, setActiveView] = createSignal<ViewId>("adm");
  const [filterQuery, setFilterQuery] = createSignal("");

  return (
    <div class="togaf-layout">
      {/* ═══ HEADER ═══ */}
      <header class="togaf-header">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ "flex-shrink": "0" }}>
          <rect width="24" height="24" rx="6" fill="var(--accent)" />
          <path d="M7 8h10M7 12h7M7 16h10" stroke="var(--bg-primary)" stroke-width="2" stroke-linecap="round" />
        </svg>
        <h1>noaide &mdash; TOGAF ADM Plan</h1>
        <div class="header-meta">
          <span class="badge badge-mauve">{store.plan.meta.version || "v1.0"}</span>
          <span class="badge badge-blue">Level {store.plan.meta.tailoring || "S"}</span>
          <span class={statusBadgeClass(store.plan.meta.status)}>
            {store.plan.meta.status || "Draft"}
          </span>
          <div class="confidence-bar" style={{ "min-width": "120px" }}>
            <div class="confidence-track">
              <div
                class="confidence-fill"
                style={{ width: `${Math.min(100, Math.max(0, store.plan.meta.confidence))}%` }}
              />
            </div>
            <span class="confidence-label">{store.plan.meta.confidence}%</span>
          </div>
          <SearchFilter placeholder="Filter sections..." onFilter={setFilterQuery} />
          <LiveIndicator status={store.status()} />
          <ThemeToggle />
        </div>
      </header>

      {/* ═══ SIDEBAR ═══ */}
      <nav class="togaf-sidebar">
        {/* View navigation */}
        <div class="sidebar-section">
          <h3>Views</h3>
          <For each={VIEWS}>
            {(view) => (
              <button
                class={`sidebar-link ${activeView() === view.id ? "active" : ""}`}
                onClick={() => setActiveView(view.id)}
              >
                <span class="nav-icon">{view.icon}</span>
                {view.label}
              </button>
            )}
          </For>
        </div>

        {/* Phase sections */}
        <For each={TOGAF_PHASES}>
          {(phase) => (
            <div class="sidebar-section">
              <h3 style={{ color: PHASE_COLORS[phase.color] || "var(--text-muted)" }}>
                {phase.name}
              </h3>
              <For each={phase.sections}>
                {(sec) => {
                  const sectionData = () => store.plan.sections[sec.id as SectionId];
                  const isDone = () => sectionData()?.status === "done";
                  return (
                    <button
                      class="sidebar-link"
                      onClick={() => setActiveView("checklist")}
                      style={{ "font-size": "0.8rem", padding: "0.25rem 1rem" }}
                    >
                      <span class="nav-icon" style={{ "font-size": "0.85rem" }}>
                        {isDone() ? "\u2713" : "\u25CB"}
                      </span>
                      <span style={{
                        color: isDone() ? "var(--text-secondary)" : "var(--text-primary)",
                        flex: "1",
                      }}>
                        {sec.id.toUpperCase().replace(/(\d)/, ".$1")} {sec.name}
                      </span>
                    </button>
                  );
                }}
              </For>
              <Show when={phase.gate !== undefined}>
                <div style={{ margin: "0.3rem 1rem" }}>
                  <span class={`gate-badge ${store.plan.gates[phase.gate!] === "pass" ? "" : store.plan.gates[phase.gate!] === "fail" ? "fail" : "pending"}`}>
                    GATE {phase.gate} {store.plan.gates[phase.gate!] === "pass" ? "\u2713" : store.plan.gates[phase.gate!] === "fail" ? "\u2717" : "\u2026"}
                  </span>
                </div>
              </Show>
            </div>
          )}
        </For>

        {/* Footer stats */}
        <div style={{
          "margin-top": "auto",
          padding: "0.8rem 1rem",
          "font-size": "0.72rem",
          color: "var(--text-muted)",
          "border-top": "1px solid var(--border)",
          "line-height": "1.5",
        }}>
          {store.doneSections()}/{store.totalSections()} Sections done | {store.gatesPassed()}/{store.totalGates()} Gates passed | {store.plan.work_packages.length} WPs | {store.plan.risks.length} Risks | {store.plan.adrs.length} ADRs
        </div>
      </nav>

      {/* ═══ MAIN CONTENT ═══ */}
      <main class="togaf-main">
        <Show when={activeView() === "adm"}>
          <ADMCycleView />
        </Show>
        <Show when={activeView() === "checklist"}>
          <MasterChecklist filter={filterQuery()} />
        </Show>
        <Show when={activeView() === "kanban"}>
          <KanbanBoard />
        </Show>
        <Show when={activeView() === "risks"}>
          <RiskMatrix />
        </Show>
        <Show when={activeView() === "workpackages"}>
          <WorkPackageGrid />
        </Show>
        <Show when={activeView() === "adrs"}>
          <ADRTable />
        </Show>
        <Show when={activeView() === "requirements"}>
          <RequirementsTable />
        </Show>
        <Show when={activeView() === "dependencies"}>
          <DependencyGraph />
        </Show>
      </main>
    </div>
  );
};

export default TOGAFDashboard;
