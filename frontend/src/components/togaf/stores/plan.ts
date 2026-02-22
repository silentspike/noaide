// ============================================================
// Plan Store — Reactive SolidJS Store for PlanDocument
// Uses reconcile() for efficient delta-updates from polling
// ============================================================

import { createStore, reconcile, produce } from "solid-js/store";
import { createSignal, createMemo } from "solid-js";
import type {
  PlanDocument,
  SectionData,
  SectionId,
  SectionStatus,
  GateStatus,
  WorkPackage,
  WPStatus,
} from "../types/plan";
import { ALL_SECTION_IDS as _ALL_SECTION_IDS } from "../types/togafPhases";

/** Connection status for the data provider */
export type ConnectionStatus = "live" | "stale" | "offline";

/** Create the reactive plan store with derived computations */
export function createPlanStore(initialData?: PlanDocument) {
  const emptyPlan: PlanDocument = {
    $schema: "togaf-plan/1.0",
    meta: {
      title: "",
      version: "v1.0",
      tailoring: "L",
      scope: "",
      status: "Draft",
      confidence: 0,
      date: "",
      wip_limit: 3,
      critical_path: "",
      footer_stats: "",
      adm_iteration: 1,
      last_updated: "",
    },
    gates: {},
    sections: {},
    work_packages: [],
    risks: [],
    adrs: [],
    requirements: [],
    dependency_graph: { critical_path: [], edges: [] },
    sprints: [],
  };

  const [store, setStore] = createStore<PlanDocument>(initialData ?? emptyPlan);
  const [status, setStatus] = createSignal<ConnectionStatus>("offline");
  const [lastFetch, setLastFetch] = createSignal<Date | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Local user edits overlay — survives polling cycles
  const localWPEdits = new Map<string, WPStatus>();
  const localSectionEdits = new Map<SectionId, SectionStatus>();

  // --- Derived computations (memoized) ---

  /** Total number of sections in the plan */
  const totalSections = createMemo(() =>
    Object.keys(store.sections).length
  );

  /** Number of sections marked as done */
  const doneSections = createMemo(() =>
    Object.values(store.sections).filter(
      (s: SectionData) => s.status === "done"
    ).length
  );

  /** Overall progress percentage (0-100) */
  const progress = createMemo(() => {
    const total = totalSections();
    return total > 0 ? Math.round((doneSections() / total) * 100) : 0;
  });

  /** Number of gates that passed */
  const gatesPassed = createMemo(() =>
    Object.values(store.gates).filter((g: GateStatus) => g === "pass").length
  );

  /** Total number of gates */
  const totalGates = createMemo(() =>
    Object.keys(store.gates).length
  );

  /** Work packages grouped by Kanban column */
  const wpByStatus = createMemo(() => {
    const groups: Record<WPStatus, WorkPackage[]> = {
      backlog: [],
      analysis: [],
      ready: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const wp of store.work_packages) {
      groups[wp.status]?.push(wp);
    }
    return groups;
  });

  /** Risk count by severity */
  const risksBySeverity = createMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const risk of store.risks) {
      counts[risk.severity]++;
    }
    return counts;
  });

  // --- Mutations ---

  /** Update the entire plan (uses reconcile for minimal DOM updates).
   *  Re-applies local user edits after reconcile so they survive polling. */
  function updatePlan(newData: PlanDocument) {
    setStore(reconcile(newData));

    // Re-apply local WP status overrides
    if (localWPEdits.size > 0) {
      setStore(
        produce((plan) => {
          for (const [wpId, wpStatus] of localWPEdits) {
            const wp = plan.work_packages.find((w) => w.id === wpId);
            if (wp) wp.status = wpStatus;
          }
        })
      );
    }

    // Re-apply local section status overrides
    if (localSectionEdits.size > 0) {
      setStore(
        produce((plan) => {
          for (const [secId, secStatus] of localSectionEdits) {
            if (plan.sections[secId]) {
              plan.sections[secId]!.status = secStatus;
            }
          }
        })
      );
    }

    setLastFetch(new Date());
    setError(null);
  }

  /** Update a single section's status */
  function setSectionStatus(sectionId: SectionId, newStatus: SectionStatus) {
    localSectionEdits.set(sectionId, newStatus);
    setStore(
      produce((plan) => {
        if (plan.sections[sectionId]) {
          plan.sections[sectionId]!.status = newStatus;
        }
      })
    );
  }

  /** Update a work package's Kanban status */
  function setWPStatus(wpId: string, newStatus: WPStatus) {
    localWPEdits.set(wpId, newStatus);
    setStore(
      produce((plan) => {
        const wp = plan.work_packages.find((w) => w.id === wpId);
        if (wp) {
          wp.status = newStatus;
        }
      })
    );
  }

  /** Clear all local edits (e.g. after server accepts changes) */
  function clearLocalEdits() {
    localWPEdits.clear();
    localSectionEdits.clear();
  }

  return {
    // Raw store (readonly access to components)
    plan: store,

    // Connection state
    status,
    setStatus,
    lastFetch,
    error,
    setError,

    // Derived computations
    totalSections,
    doneSections,
    progress,
    gatesPassed,
    totalGates,
    wpByStatus,
    risksBySeverity,

    // Mutations
    updatePlan,
    setSectionStatus,
    setWPStatus,
    clearLocalEdits,
  };
}

/** Type for the return value of createPlanStore */
export type PlanStore = ReturnType<typeof createPlanStore>;
