// ============================================================
// plan.json SSOT Schema — Version 1.0
// Datenvertrag zwischen: /impl-plan Skill, Rust Parser,
// HTML-Template (togaf-template.html), SolidJS Dashboard
// ============================================================

/** Root-Objekt: plan.json */
export interface PlanDocument {
  $schema: "togaf-plan/1.0";
  meta: PlanMeta;
  gates: GateMap;
  sections: SectionMap;
  work_packages: WorkPackage[];
  risks: Risk[];
  adrs: ADR[];
  requirements: Requirement[];
  dependency_graph: DependencyGraph;
  sprints: Sprint[];
}

// --- Meta -----------------------------------------------------------

export interface PlanMeta {
  title: string;
  version: string;
  tailoring: TailoringLevel;
  scope: string;
  status: PlanStatus;
  confidence: number;
  date: string;
  wip_limit: number;
  critical_path: string;
  footer_stats: string;
  adm_iteration: number;
  last_updated: string;
  github_repo?: string;
}

export type TailoringLevel = "S" | "M" | "L";
export type PlanStatus = "Draft" | "In Progress" | "Review" | "Final";

// --- Gates ----------------------------------------------------------

export type GateStatus = "pass" | "pending" | "fail";
export type GateMap = Record<number, GateStatus>;

// --- Sections -------------------------------------------------------

export type SectionStatus = "pending" | "in_progress" | "done" | "skipped";
export type Priority = "must" | "should" | "could" | "wont";
export type Criticality = "critical" | "high" | "medium" | "low";

export interface SectionData {
  status: SectionStatus;
  html?: string;
  content?: string;
  priority: Priority;
  criticality: Criticality;
  last_updated?: string;
}

export type SectionId =
  | "p1" | "p2" | "p3" | "p4" | "p5"
  | "a1" | "a2" | "a3" | "a4" | "a5" | "a6"
  | "b1" | "b2" | "b3"
  | "c1" | "c2" | "c3" | "c4"
  | "d1" | "d2" | "d3" | "d4" | "d5"
  | "e1" | "e2" | "e3" | "e4" | "e5" | "e6"
  | "f1" | "f2" | "f3" | "f4" | "f5"
  | "g1" | "g2" | "g3" | "g4" | "g5"
  | "h1" | "h2" | "h3" | "h4" | "h5"
  | "rm1" | "rm2" | "rm3";

export type SectionMap = Partial<Record<SectionId, SectionData>>;

// --- Work Packages --------------------------------------------------

export type WPStatus = "backlog" | "analysis" | "ready" | "in_progress" | "review" | "done";
export type WPSize = "S" | "M" | "L";
export type WPComplexity = "Simple" | "Medium" | "Complex";

export interface WorkPackage {
  id: string;
  title: string;
  status: WPStatus;
  size: WPSize;
  sprint: number;
  dependencies: string[];
  assignee: string;
  scope_files: string[];
  gate_required: boolean;
  verify_checks: VerifyCheck[];
  complexity: WPComplexity;
}

export interface VerifyCheck {
  description: string;
  passed: boolean;
  evidence?: string;
}

// --- Risks ----------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RiskStatus = "open" | "mitigated" | "accepted" | "closed";

export interface Risk {
  id: string;
  title: string;
  likelihood: RiskLevel;
  impact: RiskLevel;
  severity: RiskLevel;
  mitigation: string;
  owner: string;
  status: RiskStatus;
}

// --- ADRs -----------------------------------------------------------

export type ADRStatus = "Proposed" | "Accepted" | "Deprecated" | "Superseded";

export interface ADR {
  id: string;
  title: string;
  status: ADRStatus;
  date: string;
  context: string;
  decision: string;
  alternatives: string;
  consequences: string;
}

// --- Requirements ---------------------------------------------------

export type ReqType = "Func" | "Non-Func";
export type ReqStatus = "Draft" | "Accepted" | "Implemented" | "Verified";

export interface Requirement {
  id: string;
  description: string;
  req_type: ReqType;
  priority: Priority;
  status: ReqStatus;
  source: string;
  traces_to: string[];
  phase: string;
}

// --- Dependency Graph -----------------------------------------------

export interface DependencyGraph {
  critical_path: string[];
  edges: DependencyEdge[];
}

export interface DependencyEdge {
  from: string;
  to: string;
}

// --- Sprints --------------------------------------------------------

export interface Sprint {
  id: string;
  name: string;
  work_packages: string[];
}

// --- Kanban (derived from work_packages, optional in JSON) ----------

export type KanbanColumnId = "backlog" | "analysis" | "ready" | "in_progress" | "review" | "done";

export interface KanbanBoard {
  columns: KanbanColumn[];
  wip_limits: Partial<Record<KanbanColumnId, number>>;
}

export interface KanbanColumn {
  id: KanbanColumnId;
  name: string;
  cards: KanbanCard[];
}

export interface KanbanCard {
  wp_id: string;
  title: string;
  size: WPSize;
  assignee: string;
  blocked_by: string[];
}
