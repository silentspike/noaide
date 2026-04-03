import { createSignal, createMemo, Show, For, onMount, onCleanup } from "solid-js";
import { useSession } from "../../App";
import RequestRow from "./RequestRow";
import RequestDetail, { type RequestDetailFull } from "./RequestDetail";
import InterceptQueue from "./InterceptQueue";

export default function NetworkPanel() {
  const store = useSession();
  const [requests, setRequests] = createSignal<RequestDetailFull[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal("");
  const [methodFilter, setMethodFilter] = createSignal<string>("all");
  const [statusFilter, setStatusFilter] = createSignal<string>("all");
  const [interceptMode, setInterceptMode] = createSignal<"auto" | "manual">("auto");
  const [pendingCount, setPendingCount] = createSignal(0);
  const [categoryFilter, setCategoryFilter] = createSignal<string>("all");

  async function fetchInterceptStatus() {
    const base = store.state.httpApiUrl;
    const sid = store.state.activeSessionId;
    if (!base || !sid) return;
    try {
      const res = await fetch(`${base}/api/proxy/intercept/${sid}`);
      if (res.ok) {
        const data = await res.json();
        setInterceptMode(data.mode);
        setPendingCount(data.pendingCount + (data.pendingResponseCount || 0));
      }
    } catch {
      /* ignore */
    }
  }

  async function toggleInterceptMode() {
    const base = store.state.httpApiUrl;
    const sid = store.state.activeSessionId;
    if (!base || !sid) return;
    const newMode = interceptMode() === "auto" ? "manual" : "auto";
    try {
      await fetch(`${base}/api/proxy/intercept/${sid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      setInterceptMode(newMode);
      if (newMode === "auto") setPendingCount(0);
    } catch {
      /* ignore */
    }
  }

  async function fetchRequests() {
    const base = store.state.httpApiUrl;
    if (!base) return;
    const sid = store.state.activeSessionId;
    const url = sid
      ? `${base}/api/proxy/requests?session_id=${sid}`
      : `${base}/api/proxy/requests`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data: RequestDetailFull[] = await res.json();
        // Merge: preserve loaded detail data (bodies/headers) from previous fetches
        const prev = requests();
        const detailed = new Map(
          prev
            .filter((r) => r.requestBody || r.responseBody)
            .map((r) => [r.id, r]),
        );
        setRequests(
          data.map((r) => {
            const existing = detailed.get(r.id);
            return existing ? { ...r, ...existing } : r;
          }),
        );
      }
    } catch {
      /* ignore fetch errors — proxy may not be running */
    }
  }

  async function selectRequest(id: string) {
    const base = store.state.httpApiUrl;
    if (!base) return;
    if (selectedId() === id) {
      setSelectedId(null);
      return;
    }
    try {
      const res = await fetch(`${base}/api/proxy/requests/${id}`);
      if (res.ok) {
        const full = await res.json();
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, ...full } : r)),
        );
      }
    } catch {
      /* ignore */
    }
    setSelectedId(id);
  }

  onMount(() => {
    fetchRequests();
    fetchInterceptStatus();
    const interval = setInterval(() => {
      fetchRequests();
      fetchInterceptStatus();
    }, interceptMode() === "manual" ? 1000 : 2000);
    onCleanup(() => clearInterval(interval));
  });

  const filteredRequests = createMemo(() => {
    let items = requests();
    const query = filter().toLowerCase();
    const method = methodFilter();
    const status = statusFilter();
    const cat = categoryFilter();

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

    if (cat !== "all") {
      items = items.filter((r) => (r.category || "Unknown") === cat);
    }

    return items;
  });

  const timelineStart = createMemo(() => {
    const items = filteredRequests();
    if (items.length === 0) return 0;
    return Math.min(...items.map((r) => r.timestamp));
  });

  const timelineDuration = createMemo(() => {
    const items = filteredRequests();
    if (items.length === 0) return 1;
    const start = timelineStart();
    const end = Math.max(
      ...items.map((r) => r.timestamp + r.latencyMs),
    );
    return Math.max(end - start, 1); // avoid division by zero
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
          data-testid="network-filter"
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
          data-testid="method-filter"
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
          data-testid="status-filter"
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

        {/* Intercept Mode Toggle */}
        <Show when={store.state.activeSessionId}>
          <button
            data-testid="intercept-toggle"
            onClick={toggleInterceptMode}
            style={{
              display: "flex",
              "align-items": "center",
              gap: "4px",
              padding: "3px 10px",
              "font-size": "10px",
              "font-weight": "600",
              background:
                interceptMode() === "manual"
                  ? "var(--ctp-red)"
                  : "var(--ctp-surface1)",
              color:
                interceptMode() === "manual"
                  ? "var(--ctp-base)"
                  : "var(--ctp-overlay0)",
              border: "none",
              "border-radius": "4px",
              cursor: "pointer",
              "white-space": "nowrap",
            }}
          >
            <Show when={interceptMode() === "manual"}>
              <span
                style={{
                  width: "5px",
                  height: "5px",
                  "border-radius": "50%",
                  background: "var(--ctp-base)",
                  animation: "pulse-dot 1.5s ease-in-out infinite",
                }}
              />
            </Show>
            {interceptMode() === "manual" ? "Manual" : "Auto"}
            <Show when={pendingCount() > 0}>
              <span
                style={{
                  padding: "0 4px",
                  "border-radius": "8px",
                  background:
                    interceptMode() === "manual"
                      ? "var(--ctp-base)"
                      : "var(--ctp-red)",
                  color:
                    interceptMode() === "manual"
                      ? "var(--ctp-red)"
                      : "var(--ctp-base)",
                  "font-size": "9px",
                  "line-height": "14px",
                  "min-width": "14px",
                  "text-align": "center",
                }}
              >
                {pendingCount()}
              </span>
            </Show>
          </button>
        </Show>

        {/* Quick-Block selected domain */}
        <Show when={selectedRequest()}>
          <button
            data-testid="quick-block-btn"
            onClick={async () => {
              const base = store.state.httpApiUrl;
              const sid = store.state.activeSessionId;
              const req = selectedRequest();
              if (!base || !sid || !req) return;
              try {
                const domain = new URL(req.url).hostname;
                await fetch(`${base}/api/proxy/quick-block`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ session_id: sid, domain }),
                });
              } catch { /* ignore */ }
            }}
            style={{
              padding: "3px 8px",
              "font-size": "10px",
              background: "var(--ctp-red)",
              border: "none",
              "border-radius": "4px",
              color: "var(--ctp-base)",
              cursor: "pointer",
              "white-space": "nowrap",
              "font-weight": "600",
            }}
          >
            Block
          </button>
        </Show>

        {/* HAR Export */}
        <button
          data-testid="har-export-btn"
          onClick={() => {
            const har = {
              log: {
                version: "1.2",
                creator: { name: "noaide", version: "0.1.0" },
                entries: filteredRequests().map((r) => ({
                  startedDateTime: new Date(r.timestamp).toISOString(),
                  time: r.latencyMs,
                  request: { method: r.method, url: r.url, httpVersion: "HTTP/2", headers: [], queryString: [], bodySize: r.requestSize ?? -1 },
                  response: { status: r.statusCode, statusText: "", httpVersion: "HTTP/2", headers: [], content: { size: r.responseSize ?? -1, mimeType: "application/json" }, bodySize: r.responseSize ?? -1 },
                  timings: { send: 0, wait: r.latencyMs, receive: 0 },
                })),
              },
            };
            const blob = new Blob([JSON.stringify(har, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `noaide-${new Date().toISOString().slice(0, 10)}.har`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          style={{
            padding: "3px 8px",
            "font-size": "10px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "4px",
            color: "var(--ctp-subtext0)",
            cursor: "pointer",
            "white-space": "nowrap",
          }}
        >
          HAR
        </button>

        <span
          data-testid="request-count"
          style={{
            "font-size": "11px",
            color: "var(--ctp-overlay0)",
            "white-space": "nowrap",
          }}
        >
          {filteredRequests().length} requests
        </span>
      </div>

      {/* Latency Sparkline */}
      <Show when={filteredRequests().length > 1}>
        <div
          data-testid="latency-sparkline"
          style={{
            height: "32px",
            padding: "2px 12px",
            "border-bottom": "1px solid var(--ctp-surface0)",
            background: "var(--ctp-mantle)",
          }}
        >
          <svg width="100%" height="28" preserveAspectRatio="none" viewBox={`0 0 ${Math.min(filteredRequests().length, 100)} 28`}>
            {(() => {
              const items = filteredRequests().slice(-100);
              const maxLat = Math.max(...items.map((r) => r.latencyMs), 1);
              const points = items.map((r, i) => `${i},${28 - (r.latencyMs / maxLat) * 26}`).join(" ");
              return (
                <>
                  <polyline points={points} fill="none" stroke="var(--ctp-blue)" stroke-width="1.5" />
                  <text x="0" y="10" font-size="8" fill="var(--ctp-overlay0)">{maxLat}ms</text>
                </>
              );
            })()}
          </svg>
        </div>
      </Show>

      {/* Category Filter Chips */}
      <div
        data-testid="category-chips"
        style={{
          display: "flex",
          gap: "4px",
          padding: "4px 12px",
          "border-bottom": "1px solid var(--ctp-surface0)",
          background: "var(--ctp-mantle)",
          "flex-wrap": "wrap",
        }}
      >
        <For each={["All", "Api", "Telemetry", "Auth", "Update", "Git", "Unknown"] as const}>
          {(cat) => {
            const count = () =>
              cat === "All"
                ? requests().length
                : requests().filter((r) => (r.category || "Unknown") === cat).length;
            return (
              <button
                data-testid={`category-chip-${cat.toLowerCase()}`}
                onClick={() => setCategoryFilter(cat === "All" ? "all" : cat)}
                style={{
                  padding: "2px 8px",
                  "font-size": "10px",
                  "border-radius": "10px",
                  border: "1px solid",
                  "border-color":
                    (categoryFilter() === "all" && cat === "All") ||
                    categoryFilter() === cat
                      ? "var(--ctp-blue)"
                      : "var(--ctp-surface1)",
                  background:
                    (categoryFilter() === "all" && cat === "All") ||
                    categoryFilter() === cat
                      ? "var(--ctp-blue)"
                      : "var(--ctp-surface0)",
                  color:
                    (categoryFilter() === "all" && cat === "All") ||
                    categoryFilter() === cat
                      ? "var(--ctp-base)"
                      : "var(--ctp-subtext0)",
                  cursor: "pointer",
                  "font-weight": "500",
                }}
              >
                {cat}
                <Show when={count() > 0}>
                  <span
                    style={{
                      "margin-left": "4px",
                      opacity: "0.7",
                    }}
                  >
                    {count()}
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "12px 60px 58px 1fr 50px 60px 60px 160px",
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
        <span></span>
        <span>Method</span>
        <span>Time</span>
        <span>URL</span>
        <span>Status</span>
        <span>Size</span>
        <span>Latency</span>
        <span>Waterfall</span>
      </div>

      {/* Intercept Queue */}
      <Show
        when={
          interceptMode() === "manual" &&
          store.state.activeSessionId &&
          store.state.httpApiUrl
        }
      >
        <InterceptQueue
          sessionId={store.state.activeSessionId!}
          httpApiUrl={store.state.httpApiUrl!}
        />
      </Show>

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
                onClick={() => selectRequest(request.id)}
                timelineStart={timelineStart()}
                timelineDuration={timelineDuration()}
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
