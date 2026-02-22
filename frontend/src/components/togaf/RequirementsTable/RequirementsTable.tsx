// ============================================================
// RequirementsTable — Filterable requirements (template design)
// ============================================================

import { type Component, For, createSignal, createMemo } from "solid-js";
import { usePlan } from "../stores/planProvider";
import type { ReqType } from "../types/plan";

const TYPE_BADGE: Record<ReqType, string> = {
  Func: "badge-blue",
  "Non-Func": "badge-mauve",
};

const STATUS_BADGE: Record<string, string> = {
  Draft: "badge-lavender",
  Accepted: "badge-yellow",
  Implemented: "badge-peach",
  Verified: "badge-green",
};

const PRIORITY_BADGE: Record<string, string> = {
  must: "badge-red",
  should: "badge-yellow",
  could: "badge-blue",
  wont: "badge-lavender",
};

export const RequirementsTable: Component = () => {
  const store = usePlan();
  const [typeFilter, setTypeFilter] = createSignal<ReqType | "all">("all");
  const [statusFilter, setStatusFilter] = createSignal<string>("all");

  const filtered = createMemo(() => {
    let reqs = store.plan.requirements ?? [];
    if (typeFilter() !== "all") reqs = reqs.filter((r) => r.req_type === typeFilter());
    if (statusFilter() !== "all") reqs = reqs.filter((r) => r.status === statusFilter());
    return reqs;
  });

  return (
    <div class="section">
      <div class="section-header" style={{ cursor: "default" }}>
        <span class="section-icon">&#128203;</span>
        <h2>Requirements ({filtered().length})</h2>
        <div style={{ "margin-left": "auto", display: "flex", gap: "0.5rem" }}>
          <select
            value={typeFilter()}
            onChange={(e) => setTypeFilter(e.currentTarget.value as ReqType | "all")}
            style={{
              background: "var(--bg-primary)", color: "var(--text-primary)",
              border: "1px solid var(--border)", "border-radius": "var(--radius)",
              padding: "4px 8px", "font-size": "0.78rem", "font-family": "inherit",
            }}
          >
            <option value="all">All Types</option>
            <option value="Func">Functional</option>
            <option value="Non-Func">Non-Functional</option>
          </select>
          <select
            value={statusFilter()}
            onChange={(e) => setStatusFilter(e.currentTarget.value)}
            style={{
              background: "var(--bg-primary)", color: "var(--text-primary)",
              border: "1px solid var(--border)", "border-radius": "var(--radius)",
              padding: "4px 8px", "font-size": "0.78rem", "font-family": "inherit",
            }}
          >
            <option value="all">All Status</option>
            <option value="Draft">Draft</option>
            <option value="Accepted">Accepted</option>
            <option value="Implemented">Implemented</option>
            <option value="Verified">Verified</option>
          </select>
        </div>
      </div>
      <div class="section-body">
        <table class="togaf-table">
          <thead>
            <tr>
              <th style={{ width: "70px" }}>ID</th>
              <th>Description</th>
              <th style={{ width: "80px" }}>Type</th>
              <th style={{ width: "80px" }}>Priority</th>
              <th style={{ width: "90px" }}>Status</th>
              <th>Source</th>
              <th>Traces To</th>
            </tr>
          </thead>
          <tbody>
            <For each={filtered()}>
              {(req) => (
                <tr>
                  <td style={{ "font-weight": "700", color: "var(--blue)" }}>{req.id}</td>
                  <td style={{ "max-width": "400px" }}>{req.description}</td>
                  <td>
                    <span class={`badge ${TYPE_BADGE[req.req_type] ?? "badge-blue"}`}
                          style={{ "font-size": "0.65rem" }}>
                      {req.req_type}
                    </span>
                  </td>
                  <td>
                    <span class={`badge ${PRIORITY_BADGE[req.priority] ?? "badge-blue"}`}
                          style={{ "font-size": "0.65rem", "text-transform": "uppercase" }}>
                      {req.priority}
                    </span>
                  </td>
                  <td>
                    <span class={`badge ${STATUS_BADGE[req.status] ?? "badge-lavender"}`}
                          style={{ "font-size": "0.65rem" }}>
                      {req.status}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-secondary)", "font-size": "0.85rem" }}>
                    {req.source || "\u2014"}
                  </td>
                  <td style={{ color: "var(--text-muted)", "font-size": "0.82rem" }}>
                    {req.traces_to?.length > 0 ? req.traces_to.join(", ") : "\u2014"}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
};
