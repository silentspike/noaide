// ============================================================
// TOGAF Standard, 10th Edition — Phase Definitions
// Portiert aus /work/plan/togaf-template.html (TOGAF_PHASES)
// ============================================================

import type { TailoringLevel } from "./plan";

export interface TOGAFSection {
  id: string;
  name: string;
  /** Tailoring: P = Pflicht, R = Recommended, - = Skip */
  s: "P" | "R" | "-";
  m: "P" | "R" | "-";
  l: "P" | "R" | "-";
}

export interface TOGAFPhase {
  id: string;
  code: string;
  name: string;
  color: string;
  sections: TOGAFSection[];
  /** Gate number after this phase (0-4), undefined if no gate */
  gate?: number;
}

/** Should this section be shown for the given tailoring level? */
export function shouldShowSection(section: TOGAFSection, level: TailoringLevel): boolean {
  const key = level.toLowerCase() as "s" | "m" | "l";
  const val = section[key];
  return val === "P" || val === "R";
}

/** Is this section mandatory (Pflicht) for the given level? */
export function isMandatory(section: TOGAFSection, level: TailoringLevel): boolean {
  const key = level.toLowerCase() as "s" | "m" | "l";
  return section[key] === "P";
}

export const TOGAF_PHASES: TOGAFPhase[] = [
  {
    id: "preliminary", code: "P", name: "Preliminary", color: "green",
    sections: [
      { id: "p1", name: "Architecture Engagement Record", s: "P", m: "P", l: "P" },
      { id: "p2", name: "Architecture Principles", s: "-", m: "R", l: "P" },
      { id: "p3", name: "Stakeholder Concerns", s: "P", m: "P", l: "P" },
      { id: "p4", name: "Prerequisites", s: "-", m: "R", l: "P" },
      { id: "p5", name: "Glossar", s: "-", m: "-", l: "R" },
    ],
    gate: 0,
  },
  {
    id: "phase_a", code: "A", name: "Phase A: Architecture Vision", color: "blue",
    sections: [
      { id: "a1", name: "Vision Statement", s: "P", m: "P", l: "P" },
      { id: "a2", name: "Business Context", s: "-", m: "P", l: "P" },
      { id: "a3", name: "Stakeholder Map + RACI", s: "-", m: "R", l: "P" },
      { id: "a4", name: "Architecture Scope", s: "-", m: "P", l: "P" },
      { id: "a5", name: "Key Requirements", s: "-", m: "R", l: "P" },
      { id: "a6", name: "Building Blocks (ABBs/SBBs)", s: "-", m: "-", l: "P" },
    ],
    gate: 1,
  },
  {
    id: "phase_b", code: "B", name: "Phase B: Business Architecture", color: "teal",
    sections: [
      { id: "b1", name: "Business Capabilities & Quick Wins", s: "-", m: "P", l: "P" },
      { id: "b2", name: "Business Process Flow", s: "-", m: "-", l: "P" },
      { id: "b3", name: "Acceptance Criteria", s: "-", m: "P", l: "P" },
    ],
  },
  {
    id: "phase_c", code: "C", name: "Phase C: Information Systems", color: "sapphire",
    sections: [
      { id: "c1", name: "Data Architecture", s: "-", m: "R", l: "P" },
      { id: "c2", name: "Application Architecture", s: "-", m: "P", l: "P" },
      { id: "c3", name: "Error Handling Strategy", s: "P", m: "P", l: "P" },
      { id: "c4", name: "Security Architecture", s: "-", m: "P", l: "P" },
    ],
  },
  {
    id: "phase_d", code: "D", name: "Phase D: Technology Architecture", color: "lavender",
    sections: [
      { id: "d1", name: "Technology Stack", s: "-", m: "P", l: "P" },
      { id: "d2", name: "Environment Architecture", s: "-", m: "P", l: "P" },
      { id: "d3", name: "Feature Flags", s: "-", m: "R", l: "P" },
      { id: "d4", name: "Observability Architecture", s: "-", m: "P", l: "P" },
      { id: "d5", name: "Infrastructure", s: "-", m: "-", l: "P" },
    ],
    gate: 2,
  },
  {
    id: "phase_e", code: "E", name: "Phase E: Opportunities & Solutions", color: "peach",
    sections: [
      { id: "e1", name: "Gap Analysis", s: "-", m: "R", l: "P" },
      { id: "e2", name: "Risk Assessment", s: "P", m: "P", l: "P" },
      { id: "e3", name: "Architecture Decision Records", s: "-", m: "P", l: "P" },
      { id: "e4", name: "Work Packages (GitHub Issues)", s: "P", m: "P", l: "P" },
      { id: "e5", name: "Dependency Graph & Ordering", s: "-", m: "P", l: "P" },
      { id: "e6", name: "Git & SCM Strategy", s: "P", m: "P", l: "P" },
    ],
  },
  {
    id: "phase_f", code: "F", name: "Phase F: Migration Planning", color: "yellow",
    sections: [
      { id: "f1", name: "Test-Strategie & CI/CD Gates", s: "P", m: "P", l: "P" },
      { id: "f2", name: "Real-World Testing", s: "-", m: "P", l: "P" },
      { id: "f3", name: "Release & Deployment Plan", s: "-", m: "P", l: "P" },
      { id: "f4", name: "Rollback Architecture", s: "-", m: "R", l: "P" },
      { id: "f5", name: "Kanban Board Setup", s: "-", m: "P", l: "P" },
    ],
    gate: 3,
  },
  {
    id: "phase_g", code: "G", name: "Phase G: Implementation Governance", color: "pink",
    sections: [
      { id: "g1", name: "Architecture Compliance Review", s: "-", m: "P", l: "P" },
      { id: "g2", name: "Definition of Done", s: "P", m: "P", l: "P" },
      { id: "g3", name: "Success Metrics", s: "-", m: "R", l: "P" },
      { id: "g4", name: "Post-Implementation Cleanup", s: "-", m: "R", l: "P" },
      { id: "g5", name: "Documentation Updates", s: "-", m: "P", l: "P" },
    ],
    gate: 4,
  },
  {
    id: "phase_h", code: "H", name: "Phase H: Architecture Change Mgmt", color: "red",
    sections: [
      { id: "h1", name: "Architecture Change Log", s: "-", m: "R", l: "P" },
      { id: "h2", name: "Lessons Learned", s: "P", m: "P", l: "P" },
      { id: "h3", name: "Architecture Repository Updates", s: "-", m: "-", l: "P" },
      { id: "h4", name: "Plan-Qualitaet Retrospektive", s: "-", m: "R", l: "P" },
      { id: "h5", name: "Next Steps & Change Requests", s: "-", m: "R", l: "P" },
    ],
  },
  {
    id: "req_mgmt", code: "RM", name: "Requirements Management", color: "mauve",
    sections: [
      { id: "rm1", name: "Requirements Register", s: "-", m: "R", l: "P" },
      { id: "rm2", name: "Change Request Log", s: "-", m: "-", l: "P" },
      { id: "rm3", name: "Traceability Matrix", s: "-", m: "-", l: "P" },
    ],
  },
];

/** All 47 section IDs in order */
export const ALL_SECTION_IDS = TOGAF_PHASES.flatMap(p => p.sections.map(s => s.id));

/** Lookup: section ID -> phase */
export const SECTION_TO_PHASE = new Map(
  TOGAF_PHASES.flatMap(p => p.sections.map(s => [s.id, p] as const))
);

/** Lookup: section ID -> section definition */
export const SECTION_DEFS = new Map(
  TOGAF_PHASES.flatMap(p => p.sections.map(s => [s.id, s] as const))
);
