import { createSignal, createMemo, Show, For } from "solid-js";
import RequestRow from "./RequestRow";
import RequestDetail, { type RequestDetailFull } from "./RequestDetail";

export default function NetworkPanel() {
  const [requests, _setRequests] = createSignal<RequestDetailFull[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal("");
  const [methodFilter, setMethodFilter] = createSignal<string>("all");
  const [statusFilter, setStatusFilter] = createSignal<string>("all");

  const filteredRequests = createMemo(() => {
    let items = requests();
    const query = filter().toLowerCase();
    const method = methodFilter();
    const status = statusFilter();

    if (query) {
      items = items.filter(
        (r) =>
          r.url.toLowerCase().includes(query) ||
          r.method.toLowerCase().includes(query),
      );
    }

    if (method !== "all") {
      items = items.filter((r) => r.method === method);
    }

    if (status === "2xx") {
      items = items.filter((r) => r.statusCode >= 200 && r.statusCode < 300);
    } else if (status === "4xx") {
      items = items.filter((r) => r.statusCode >= 400 && r.statusCode < 500);
    } else if (status === "5xx") {
      items = items.filter((r) => r.statusCode >= 500);
    }

    return items;
  });

  const selectedRequest = createMemo(() => {
    const id = selectedId();
    if (!id) return null;
    return requests().find((r) => r.id === id) ?? null;
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--ctp-base)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--ctp-surface0)",
          background: "var(--ctp-mantle)",
        }}
      >
        <input
          type="text"
          placeholder="Filter URL..."
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          style={{
            flex: "1",
            padding: "4px 8px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "4px",
            color: "var(--ctp-text)",
            "font-size": "11px",
            outline: "none",
          }}
        />
        <select
          value={methodFilter()}
          onChange={(e) => setMethodFilter(e.currentTarget.value)}
          style={{
            padding: "4px 8px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "4px",
            color: "var(--ctp-text)",
            "font-size": "11px",
          }}
        >
          <option value="all">All Methods</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </select>
        <select
          value={statusFilter()}
          onChange={(e) => setStatusFilter(e.currentTarget.value)}
          style={{
            padding: "4px 8px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "4px",
            color: "var(--ctp-text)",
            "font-size": "11px",
          }}
        >
          <option value="all">All Status</option>
          <option value="2xx">2xx</option>
          <option value="4xx">4xx</option>
          <option value="5xx">5xx</option>
        </select>
        <span
          style={{
            "font-size": "11px",
            color: "var(--ctp-overlay0)",
            "white-space": "nowrap",
          }}
        >
          {filteredRequests().length} requests
        </span>
      </div>

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "60px 1fr 50px 60px 60px",
          gap: "8px",
          padding: "4px 12px",
          "font-size": "10px",
          "font-weight": "600",
          color: "var(--ctp-overlay0)",
          "text-transform": "uppercase",
          "letter-spacing": "0.05em",
          "border-bottom": "1px solid var(--ctp-surface0)",
        }}
      >
        <span>Method</span>
        <span>URL</span>
        <span>Status</span>
        <span>Size</span>
        <span>Time</span>
      </div>

      {/* Request list */}
      <div
        style={{
          flex: selectedRequest() ? "0 0 50%" : "1",
          overflow: "auto",
          "min-height": "0",
        }}
      >
        <Show
          when={filteredRequests().length > 0}
          fallback={
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                height: "100%",
                color: "var(--ctp-overlay0)",
                "font-size": "12px",
              }}
            >
              No API requests captured
            </div>
          }
        >
          <For each={filteredRequests()}>
            {(request) => (
              <RequestRow
                request={request}
                isSelected={selectedId() === request.id}
                onClick={() =>
                  setSelectedId(
                    selectedId() === request.id ? null : request.id,
                  )
                }
              />
            )}
          </For>
        </Show>
      </div>

      {/* Detail panel */}
      <Show when={selectedRequest()}>
        <div style={{ flex: "0 0 50%", "min-height": "0" }}>
          <RequestDetail request={selectedRequest()!} />
        </div>
      </Show>
    </div>
  );
}
