import { createSignal, Show, For, onMount, onCleanup } from "solid-js";

interface PendingIntercept {
  id: string;
  method: string;
  url: string;
  provider: string;
  bodyPreview: string;
  headers: { name: string; value: string }[];
  timestamp: number;
  disconnected?: boolean;
}

interface PendingResponseIntercept {
  id: string;
  method: string;
  url: string;
  provider: string;
  statusCode: number;
  bodyPreview: string;
  headers: { name: string; value: string }[];
  timestamp: number;
  disconnected?: boolean;
}

interface ParsedRequest {
  model: string;
  maxTokens: number;
  system: string;
  messages: { role: string; content: string }[];
}

interface ParsedResponse {
  model: string;
  type: string;
  stopReason: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
}

function parseRequestBody(raw: string): ParsedRequest | null {
  try {
    const obj = JSON.parse(raw);
    const model = obj.model || "";
    const maxTokens = obj.max_tokens || 0;
    let system = "";
    if (typeof obj.system === "string") {
      system = obj.system;
    } else if (Array.isArray(obj.system)) {
      system = obj.system.map(function (s: { text?: string }) { return s.text || ""; }).join("\n");
    }
    const messages: { role: string; content: string }[] = [];
    if (Array.isArray(obj.messages)) {
      for (const msg of obj.messages) {
        const role = msg.role || "?";
        let content = "";
        if (typeof msg.content === "string") {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content
            .map(function (c: { type?: string; text?: string }) { return c.text || "[" + (c.type || "block") + "]"; })
            .join("\n");
        }
        messages.push({ role, content });
      }
    }
    return { model, maxTokens, system, messages };
  } catch {
    return null;
  }
}

function parseResponseBody(raw: string): ParsedResponse | null {
  try {
    const obj = JSON.parse(raw);
    const model = obj.model || "";
    const type = obj.type || "";
    const stopReason = obj.stop_reason || "";
    let content = "";
    if (Array.isArray(obj.content)) {
      content = obj.content
        .map(function (c: { type?: string; text?: string }) { return c.text || "[" + (c.type || "block") + "]"; })
        .join("\n");
    }
    const inputTokens = obj.usage?.input_tokens || 0;
    const outputTokens = obj.usage?.output_tokens || 0;
    return { model, type, stopReason, content, inputTokens, outputTokens };
  } catch {
    return null;
  }
}

interface InterceptQueueProps {
  sessionId: string;
  httpApiUrl: string;
}

const badgeStyle = (bg: string, fg: string) => ({
  display: "inline-block",
  padding: "1px 6px",
  "border-radius": "3px",
  "font-size": "10px",
  "font-weight": "600",
  background: bg,
  color: fg,
  "margin-right": "4px",
});

const contentBlockStyle = {
  margin: "4px 0 0 0",
  padding: "6px 8px",
  background: "var(--ctp-mantle)",
  "border-radius": "4px",
  "font-size": "11px",
  "line-height": "1.5",
  color: "var(--ctp-text)",
  "white-space": "pre-wrap" as const,
  "word-break": "break-word" as const,
  "max-height": "120px",
  overflow: "auto",
};

export default function InterceptQueue(props: InterceptQueueProps) {
  const [pending, setPending] = createSignal<PendingIntercept[]>([]);
  const [pendingResponses, setPendingResponses] = createSignal<
    PendingResponseIntercept[]
  >([]);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editBody, setEditBody] = createSignal("");
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  async function fetchPending() {
    try {
      const res = await fetch(
        `${props.httpApiUrl}/api/proxy/intercept/${props.sessionId}/pending`,
      );
      if (res.ok) {
        setPending(await res.json());
      }
    } catch {
      /* ignore */
    }
  }

  async function fetchPendingResponses() {
    try {
      const res = await fetch(
        `${props.httpApiUrl}/api/proxy/intercept/${props.sessionId}/pending-responses`,
      );
      if (res.ok) {
        setPendingResponses(await res.json());
      }
    } catch {
      /* ignore */
    }
  }

  async function forwardRequest(id: string, modifiedBody?: string) {
    try {
      const body = modifiedBody
        ? JSON.stringify({ modified_body: modifiedBody })
        : "{}";
      await fetch(
        `${props.httpApiUrl}/api/proxy/intercept/${props.sessionId}/pending/${id}/forward`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      );
      setPending((prev) => prev.filter((p) => p.id !== id));
      if (editingId() === id) setEditingId(null);
    } catch {
      /* ignore */
    }
  }

  async function dropRequest(id: string) {
    try {
      await fetch(
        `${props.httpApiUrl}/api/proxy/intercept/${props.sessionId}/pending/${id}/drop`,
        { method: "POST" },
      );
      setPending((prev) => prev.filter((p) => p.id !== id));
      if (editingId() === id) setEditingId(null);
    } catch {
      /* ignore */
    }
  }

  async function forwardResponse(id: string, modifiedBody?: string) {
    try {
      const body = modifiedBody
        ? JSON.stringify({ modified_body: modifiedBody })
        : "{}";
      await fetch(
        `${props.httpApiUrl}/api/proxy/intercept/${props.sessionId}/pending-responses/${id}/forward`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      );
      setPendingResponses((prev) => prev.filter((p) => p.id !== id));
      if (editingId() === id) setEditingId(null);
    } catch {
      /* ignore */
    }
  }

  function prettyJson(raw: string): string {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  function toggleEdit(id: string, bodyPreview: string) {
    if (editingId() === id) {
      setEditingId(null);
    } else {
      setEditingId(id);
      setEditBody(prettyJson(bodyPreview));
    }
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId() === id ? null : id);
  }

  onMount(() => {
    fetchPending();
    fetchPendingResponses();
    const interval = setInterval(() => {
      fetchPending();
      fetchPendingResponses();
    }, 800);
    onCleanup(() => clearInterval(interval));
  });

  const actionButtonStyle = (color: string) => ({
    padding: "2px 8px",
    "font-size": "10px",
    "font-weight": "600",
    background: `var(--ctp-${color})`,
    color: "var(--ctp-base)",
    border: "none",
    "border-radius": "3px",
    cursor: "pointer",
  });

  return (
    <Show when={pending().length > 0 || pendingResponses().length > 0}>
      <div
        data-testid="intercept-queue"
        style={{
          background: "rgba(243, 139, 168, 0.04)",
          "border-bottom": "2px solid var(--ctp-red)",
        }}
      >
        {/* ── Intercepted Requests ────────────────────────────── */}
        <Show when={pending().length > 0}>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
              padding: "6px 12px",
              "font-size": "11px",
              "font-weight": "600",
              color: "var(--ctp-red)",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                "border-radius": "50%",
                background: "var(--ctp-red)",
                animation: "pulse-dot 1.5s ease-in-out infinite",
              }}
            />
            Intercepted Requests ({pending().length})
          </div>

          <For each={pending()}>
            {(item) => {
              const parsed = () => parseRequestBody(item.bodyPreview);
              const firstUserMsg = () => {
                const p = parsed();
                if (!p) return "";
                const msg = p.messages.find(function (m) { return m.role === "user"; });
                return msg ? msg.content : "";
              };
              return (
                <div
                  data-testid={`intercept-req-${item.id}`}
                  style={{
                    padding: "8px 12px",
                    "border-top": "1px solid var(--ctp-surface0)",
                  }}
                >
                  {/* ── Summary Row ── */}
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "6px",
                      "font-size": "11px",
                    }}
                  >
                    <Show when={parsed()?.model} fallback={
                      <span style={{ color: "var(--ctp-blue)", "font-weight": "600" }}>
                        {item.method}
                      </span>
                    }>
                      <span style={badgeStyle("var(--ctp-blue)", "var(--ctp-base)")}>
                        {parsed()!.model}
                      </span>
                    </Show>
                    <Show when={parsed() && parsed()!.messages.length > 0}>
                      <span style={badgeStyle("var(--ctp-surface1)", "var(--ctp-subtext0)")}>
                        {parsed()!.messages.length} msg{parsed()!.messages.length !== 1 ? "s" : ""}
                      </span>
                    </Show>
                    <span
                      onClick={() => toggleExpand(item.id)}
                      style={{
                        flex: "1",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                        color: "var(--ctp-subtext0)",
                        cursor: "pointer",
                      }}
                      title="Click to expand"
                    >
                      {firstUserMsg() || item.url}
                    </span>
                    <span style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>
                      {Math.round((Date.now() - item.timestamp) / 1000)}s
                    </span>
                    <button
                      data-testid={`intercept-forward-${item.id}`}
                      onClick={() => forwardRequest(item.id)}
                      style={actionButtonStyle("green")}
                    >
                      Forward
                    </button>
                    <button
                      data-testid={`intercept-edit-${item.id}`}
                      onClick={() => toggleEdit(item.id, item.bodyPreview)}
                      style={{
                        padding: "2px 8px",
                        "font-size": "10px",
                        "font-weight": "600",
                        background:
                          editingId() === item.id
                            ? "var(--ctp-blue)"
                            : "var(--ctp-surface1)",
                        color:
                          editingId() === item.id
                            ? "var(--ctp-base)"
                            : "var(--ctp-text)",
                        border: "none",
                        "border-radius": "3px",
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                    <button
                      data-testid={`intercept-drop-${item.id}`}
                      onClick={() => dropRequest(item.id)}
                      style={actionButtonStyle("red")}
                    >
                      Drop
                    </button>
                  </div>

                  {/* ── Expanded Content (user-friendly, no JSON) ── */}
                  <Show when={expandedId() === item.id && editingId() !== item.id && parsed()}>
                    <div style={{ "margin-top": "8px", "font-size": "11px" }}>
                      <Show when={parsed()!.system}>
                        <div style={{ "margin-bottom": "6px" }}>
                          <span style={badgeStyle("var(--ctp-peach)", "var(--ctp-base)")}>
                            System
                          </span>
                          <div
                            style={{
                              ...contentBlockStyle,
                              "border-left": "3px solid var(--ctp-peach)",
                              "max-height": "80px",
                            }}
                          >
                            {parsed()!.system.length > 200
                              ? parsed()!.system.substring(0, 200) + "..."
                              : parsed()!.system}
                          </div>
                        </div>
                      </Show>
                      <For each={parsed()!.messages}>
                        {(msg) => (
                          <div style={{ "margin-bottom": "4px" }}>
                            <span
                              style={badgeStyle(
                                msg.role === "user"
                                  ? "var(--ctp-green)"
                                  : msg.role === "assistant"
                                    ? "var(--ctp-blue)"
                                    : "var(--ctp-surface1)",
                                msg.role === "user" || msg.role === "assistant"
                                  ? "var(--ctp-base)"
                                  : "var(--ctp-text)",
                              )}
                            >
                              {msg.role}
                            </span>
                            <div style={contentBlockStyle}>
                              {msg.content.length > 500
                                ? msg.content.substring(0, 500) + "..."
                                : msg.content}
                            </div>
                          </div>
                        )}
                      </For>
                      <Show when={parsed()!.maxTokens > 0}>
                        <div style={{ "margin-top": "6px", color: "var(--ctp-overlay0)", "font-size": "10px" }}>
                          max {parsed()!.maxTokens} tokens
                        </div>
                      </Show>
                    </div>
                  </Show>

                  {/* ── Edit Panel (raw JSON textarea) ── */}
                  <Show when={editingId() === item.id}>
                    <div style={{ "margin-top": "6px" }}>
                      <textarea
                        data-testid="intercept-edit-body"
                        value={editBody()}
                        onInput={(e) => setEditBody(e.currentTarget.value)}
                        style={{
                          width: "100%",
                          height: "200px",
                          padding: "6px 8px",
                          background: "var(--ctp-surface0)",
                          border: "1px solid var(--ctp-surface1)",
                          "border-radius": "4px",
                          color: "var(--ctp-text)",
                          "font-family":
                            "var(--font-mono, 'GeistMono', monospace)",
                          "font-size": "11px",
                          resize: "vertical",
                        }}
                        spellcheck={false}
                      />
                      <div
                        style={{
                          display: "flex",
                          gap: "6px",
                          "margin-top": "4px",
                          "justify-content": "flex-end",
                        }}
                      >
                        <button
                          data-testid="intercept-cancel-edit"
                          onClick={() => setEditingId(null)}
                          style={{
                            padding: "2px 10px",
                            "font-size": "10px",
                            background: "var(--ctp-surface1)",
                            color: "var(--ctp-text)",
                            border: "none",
                            "border-radius": "3px",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          data-testid="intercept-forward-modified"
                          onClick={() => forwardRequest(item.id, editBody())}
                          style={{
                            padding: "2px 10px",
                            "font-size": "10px",
                            "font-weight": "600",
                            background: "var(--ctp-green)",
                            color: "var(--ctp-base)",
                            border: "none",
                            "border-radius": "3px",
                            cursor: "pointer",
                          }}
                        >
                          Forward Modified
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>

        {/* ── Intercepted Responses ───────────────────────────── */}
        <Show when={pendingResponses().length > 0}>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
              padding: "6px 12px",
              "font-size": "11px",
              "font-weight": "600",
              color: "var(--ctp-peach)",
              "border-top":
                pending().length > 0
                  ? "1px solid var(--ctp-surface0)"
                  : "none",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                "border-radius": "50%",
                background: "var(--ctp-peach)",
                animation: "pulse-dot 1.5s ease-in-out infinite",
              }}
            />
            Intercepted Responses ({pendingResponses().length})
          </div>

          <For each={pendingResponses()}>
            {(item) => {
              const parsed = () => parseResponseBody(item.bodyPreview);
              const contentPreview = () => {
                const p = parsed();
                if (!p) return "";
                return p.content || p.type || "";
              };
              return (
                <div
                  data-testid={`intercept-resp-${item.id}`}
                  style={{
                    padding: "8px 12px",
                    "border-top": "1px solid var(--ctp-surface0)",
                  }}
                >
                  {/* ── Summary Row ── */}
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "6px",
                      "font-size": "11px",
                    }}
                  >
                    <span
                      style={badgeStyle(
                        item.statusCode >= 400 ? "var(--ctp-red)" :
                          item.statusCode >= 300 ? "var(--ctp-yellow)" :
                            "var(--ctp-green)",
                        "var(--ctp-base)",
                      )}
                    >
                      {item.statusCode}
                    </span>
                    <Show when={parsed()?.model}>
                      <span style={badgeStyle("var(--ctp-blue)", "var(--ctp-base)")}>
                        {parsed()!.model}
                      </span>
                    </Show>
                    <Show when={parsed()?.stopReason}>
                      <span style={badgeStyle(
                        parsed()!.stopReason === "end_turn" ? "var(--ctp-green)" : "var(--ctp-yellow)",
                        "var(--ctp-base)",
                      )}>
                        {parsed()!.stopReason}
                      </span>
                    </Show>
                    <Show when={parsed()?.inputTokens || parsed()?.outputTokens}>
                      <span style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>
                        {parsed()!.inputTokens} in / {parsed()!.outputTokens} out
                      </span>
                    </Show>
                    <span
                      onClick={() => toggleExpand(item.id)}
                      style={{
                        flex: "1",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                        color: "var(--ctp-subtext0)",
                        cursor: "pointer",
                      }}
                      title="Click to expand"
                    >
                      {contentPreview() || item.url}
                    </span>
                    <span style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>
                      {Math.round((Date.now() - item.timestamp) / 1000)}s
                    </span>
                    <button
                      data-testid={`intercept-resp-forward-${item.id}`}
                      onClick={() => forwardResponse(item.id)}
                      style={actionButtonStyle("green")}
                    >
                      Forward
                    </button>
                    <button
                      data-testid={`intercept-resp-edit-${item.id}`}
                      onClick={() => toggleEdit(item.id, item.bodyPreview)}
                      style={{
                        padding: "2px 8px",
                        "font-size": "10px",
                        "font-weight": "600",
                        background:
                          editingId() === item.id
                            ? "var(--ctp-blue)"
                            : "var(--ctp-surface1)",
                        color:
                          editingId() === item.id
                            ? "var(--ctp-base)"
                            : "var(--ctp-text)",
                        border: "none",
                        "border-radius": "3px",
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                  </div>

                  {/* ── Expanded Content (user-friendly, no JSON) ── */}
                  <Show when={expandedId() === item.id && editingId() !== item.id && parsed()}>
                    <div style={{ "margin-top": "8px", "font-size": "11px" }}>
                      <Show when={parsed()!.content}>
                        <div style={{ "margin-bottom": "4px" }}>
                          <span style={badgeStyle("var(--ctp-blue)", "var(--ctp-base)")}>
                            Response
                          </span>
                          <div style={contentBlockStyle}>
                            {parsed()!.content}
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  {/* ── Edit Panel (raw JSON textarea) ── */}
                  <Show when={editingId() === item.id}>
                    <div style={{ "margin-top": "6px" }}>
                      <textarea
                        data-testid="intercept-resp-edit-body"
                        value={editBody()}
                        onInput={(e) => setEditBody(e.currentTarget.value)}
                        style={{
                          width: "100%",
                          height: "200px",
                          padding: "6px 8px",
                          background: "var(--ctp-surface0)",
                          border: "1px solid var(--ctp-surface1)",
                          "border-radius": "4px",
                          color: "var(--ctp-text)",
                          "font-family":
                            "var(--font-mono, 'GeistMono', monospace)",
                          "font-size": "11px",
                          resize: "vertical",
                        }}
                        spellcheck={false}
                      />
                      <div
                        style={{
                          display: "flex",
                          gap: "6px",
                          "margin-top": "4px",
                          "justify-content": "flex-end",
                        }}
                      >
                        <button
                          data-testid="intercept-resp-cancel-edit"
                          onClick={() => setEditingId(null)}
                          style={{
                            padding: "2px 10px",
                            "font-size": "10px",
                            background: "var(--ctp-surface1)",
                            color: "var(--ctp-text)",
                            border: "none",
                            "border-radius": "3px",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          data-testid="intercept-resp-forward-modified"
                          onClick={() => forwardResponse(item.id, editBody())}
                          style={{
                            padding: "2px 10px",
                            "font-size": "10px",
                            "font-weight": "600",
                            background: "var(--ctp-green)",
                            color: "var(--ctp-base)",
                            border: "none",
                            "border-radius": "3px",
                            cursor: "pointer",
                          }}
                        >
                          Forward Modified
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </Show>
  );
}
