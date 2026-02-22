// ============================================================
// PlanDataProvider — Abstraction layer for plan.json data source
//
// Two providers, same interface:
// - StandalonePlanProvider: fetch-polling on plan.json (2s interval)
// - IntegrationPlanProvider: WebTransport push (Phase C, stub)
//
// Components use usePlan() and never know WHERE data comes from.
// ============================================================

import {
  createContext,
  useContext,
  onMount,
  onCleanup,
  type ParentProps,
} from "solid-js";
import type { PlanDocument } from "../types/plan";
import { createPlanStore, type PlanStore } from "./plan";

// --- Context ---

const PlanContext = createContext<PlanStore>();

/** Access the plan store from any child component */
export function usePlan(): PlanStore {
  const ctx = useContext(PlanContext);
  if (!ctx) {
    throw new Error("usePlan() must be used within a PlanProvider");
  }
  return ctx;
}

// --- Standalone Provider (fetch polling) ---

interface StandaloneProps extends ParentProps {
  /** URL to plan.json (relative or absolute) */
  planUrl: string;
  /** Polling interval in ms (default: 2000) */
  pollIntervalMs?: number;
}

/**
 * Standalone plan provider that polls plan.json at a regular interval.
 *
 * Usage:
 * ```tsx
 * <StandalonePlanProvider planUrl="plan.json" pollIntervalMs={2000}>
 *   <TOGAFDashboard />
 * </StandalonePlanProvider>
 * ```
 */
export function StandalonePlanProvider(props: StandaloneProps) {
  const store = createPlanStore();
  let intervalId: ReturnType<typeof setInterval> | undefined;

  async function fetchPlan() {
    try {
      const res = await fetch(props.planUrl);
      if (!res.ok) {
        store.setError(`HTTP ${res.status}: ${res.statusText}`);
        store.setStatus("stale");
        return;
      }
      const data: PlanDocument = await res.json();
      store.updatePlan(data);
      store.setStatus("live");
    } catch (err) {
      store.setError(err instanceof Error ? err.message : String(err));
      store.setStatus("offline");
    }
  }

  onMount(() => {
    // Initial fetch
    fetchPlan();

    // Start polling
    const interval = props.pollIntervalMs ?? 2000;
    intervalId = setInterval(fetchPlan, interval);
  });

  onCleanup(() => {
    if (intervalId !== undefined) {
      clearInterval(intervalId);
    }
  });

  return (
    <PlanContext.Provider value={store}>
      {props.children}
    </PlanContext.Provider>
  );
}

// --- Integration Provider (WebTransport — Phase C stub) ---

interface IntegrationProps extends ParentProps {
  /** Active noaide session ID */
  sessionId: string;
}

/**
 * Integration plan provider that receives updates via WebTransport.
 * Stub for Phase C — will be implemented when WP-7 (WebTransport) is done.
 */
export function IntegrationPlanProvider(props: IntegrationProps) {
  const store = createPlanStore();

  onMount(() => {
    // Phase C: Connect to WebTransport endpoint
    // const wt = new WebTransport(`https://localhost:4433/plan/${props.sessionId}`);
    // wt.datagrams.readable → reconcile updates
    store.setStatus("offline");
    store.setError("WebTransport provider not yet implemented (Phase C)");
  });

  return (
    <PlanContext.Provider value={store}>
      {props.children}
    </PlanContext.Provider>
  );
}

// --- Static Provider (for testing/storybook) ---

interface StaticProps extends ParentProps {
  /** Pre-loaded plan data */
  data: PlanDocument;
}

/**
 * Static plan provider for testing — loads data once, no polling.
 */
export function StaticPlanProvider(props: StaticProps) {
  // eslint-disable-next-line solid/reactivity -- one-time init from static data
  const store = createPlanStore(props.data);

  onMount(() => {
    store.setStatus("live");
  });

  return (
    <PlanContext.Provider value={store}>
      {props.children}
    </PlanContext.Provider>
  );
}
