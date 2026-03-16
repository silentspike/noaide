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

/** Callback for sending PATCH mutations to the backend */
export type PatchFn = (path: string, body: Record<string, unknown>) => Promise<void>;

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

  // PATCH callback — set by the provider to send mutations to backend
  let patchApi: PatchFn | null = null;
  function setPatchApi(fn: PatchFn) { patchApi = fn; }

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

  // --- Undo/Redo History ---

  interface EditEntry {
    type: "wp_status" | "section_status" | "gate_status";
    id: string;
    oldValue: string;
    newValue: string;
    timestamp: number;
  }

  const MAX_HISTORY = 50;
  const [editHistory, setEditHistory] = createSignal<EditEntry[]>([]);
  const [redoStack, setRedoStack] = createSignal<EditEntry[]>([]);

  const canUndo = createMemo(() => editHistory().length > 0);
  const canRedo = createMemo(() => redoStack().length > 0);

  function pushEdit(entry: EditEntry) {
    setEditHistory((h) => {
      const next = [...h, entry];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
    setRedoStack([]); // clear redo on new edit
  }

  function undo() {
    const history = editHistory();
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setEditHistory((h) => h.slice(0, -1));
    setRedoStack((r) => [...r, last]);
    // Apply the old value (skip pushing to history by calling internal apply)
    applyEdit(last.type, last.id, last.oldValue);
  }

  function redo() {
    const stack = redoStack();
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setEditHistory((h) => [...h, entry]);
    applyEdit(entry.type, entry.id, entry.newValue);
  }

  /** Apply an edit without recording it in history (used by undo/redo) */
  function applyEdit(type: string, id: string, value: string) {
    if (type === "wp_status") {
      localWPEdits.set(id, value as WPStatus);
      setStore(produce((plan) => {
        const wp = plan.work_packages.find((w) => w.id === id);
        if (wp) wp.status = value as WPStatus;
      }));
      patchApi?.(`/api/plan/work-packages/${id}`, { status: value });
    } else if (type === "section_status") {
      localSectionEdits.set(id as SectionId, value as SectionStatus);
      setStore(produce((plan) => {
        if (plan.sections[id as SectionId]) {
          plan.sections[id as SectionId]!.status = value as SectionStatus;
        }
      }));
      patchApi?.(`/api/plan/sections/${id}`, { status: value });
    } else if (type === "gate_status") {
      setStore(produce((plan) => {
        plan.gates[Number(id)] = value as any;
      }));
      patchApi?.(`/api/plan/gates/${id}`, { status: value });
    }
  }

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
    const oldStatus = store.sections[sectionId]?.status ?? "pending";
    if (oldStatus !== newStatus) {
      pushEdit({ type: "section_status", id: sectionId, oldValue: oldStatus, newValue: newStatus, timestamp: Date.now() });
    }
    localSectionEdits.set(sectionId, newStatus);
    setStore(
      produce((plan) => {
        if (plan.sections[sectionId]) {
          plan.sections[sectionId]!.status = newStatus;
        }
      })
    );
    patchApi?.(`/api/plan/sections/${sectionId}`, { status: newStatus });
  }

  /** Update a work package's Kanban status */
  function setWPStatus(wpId: string, newStatus: WPStatus) {
    const oldStatus = store.work_packages.find((w) => w.id === wpId)?.status ?? "backlog";
    if (oldStatus !== newStatus) {
      pushEdit({ type: "wp_status", id: wpId, oldValue: oldStatus, newValue: newStatus, timestamp: Date.now() });
    }
    localWPEdits.set(wpId, newStatus);
    setStore(
      produce((plan) => {
        const wp = plan.work_packages.find((w) => w.id === wpId);
        if (wp) {
          wp.status = newStatus;
        }
      })
    );
    patchApi?.(`/api/plan/work-packages/${wpId}`, { status: newStatus });
  }

  /** Update a gate's status */
  function setGateStatus(gate: number, newStatus: string) {
    const oldStatus = String(store.gates[gate] ?? "pending");
    if (oldStatus !== newStatus) {
      pushEdit({ type: "gate_status", id: String(gate), oldValue: oldStatus, newValue: newStatus, timestamp: Date.now() });
    }
    setStore(
      produce((plan) => {
        plan.gates[gate] = newStatus as any;
      })
    );
    patchApi?.(`/api/plan/gates/${gate}`, { status: newStatus });
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
    setGateStatus,
    clearLocalEdits,
    setPatchApi,

    // Undo/Redo
    undo,
    redo,
    canUndo,
    canRedo,
    editHistory,
  };
}

/** Type for the return value of createPlanStore */
export type PlanStore = ReturnType<typeof createPlanStore>;
