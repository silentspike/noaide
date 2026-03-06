import { createSignal, Show, For, createMemo } from "solid-js";
import type { ApiRequest } from "./RequestRow";

interface RequestDetailFull extends ApiRequest {
  requestBody: string;
  responseBody: string;
  requestHeaders: [string, string][];
  responseHeaders: [string, string][];
}

interface RequestDetailProps {
  request: RequestDetailFull;
}

type Tab = "response" | "request" | "headers";

export type { RequestDetailFull };
export { tryParseJson, parseSseEvents, extractResponseContent };

/** Try to parse JSON and pretty-print it. */
function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Parse SSE stream into individual events. */
function parseSseEvents(
  text: string,
): { event: string; data: unknown | string }[] {
  const events: { event: string; data: unknown | string }[] = [];
  let currentEvent = "";
  let currentData = "";

  for (const line of text.split("\n")) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6);
    } else if (line.trim() === "" && (currentEvent || currentData)) {
      const parsed = tryParseJson(currentData);
      events.push({
        event: currentEvent || "data",
        data: parsed !== null ? parsed : currentData,
      });
      currentEvent = "";
      currentData = "";
    }
  }
  // Leftover
  if (currentEvent || currentData) {
    const parsed = tryParseJson(currentData);
    events.push({
      event: currentEvent || "data",
      data: parsed !== null ? parsed : currentData,
    });
  }
  return events;
}

/** Extract text blocks from an API response SSE stream. */
function extractResponseContent(body: string): {
  model: string;
  text: string;
  thinking: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
} {
  const events = parseSseEvents(body);
  let model = "";
  let text = "";
  let thinking = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "";

  for (const ev of events) {
    const d = ev.data as Record<string, unknown>;
    if (!d || typeof d !== "object") continue;

    if (d.type === "message_start") {
      const msg = d.message as Record<string, unknown>;
      if (msg) {
        model = (msg.model as string) || "";
        const usage = msg.usage as Record<string, number>;
        if (usage) inputTokens = usage.input_tokens || 0;
      }
    } else if (d.type === "content_block_delta") {
      const delta = d.delta as Record<string, unknown>;
      if (delta) {
        if (delta.type === "text_delta") {
          text += (delta.text as string) || "";
        } else if (delta.type === "thinking_delta") {
          thinking += (delta.thinking as string) || "";
        }
      }
    } else if (d.type === "message_delta") {
      const delta = d.delta as Record<string, unknown>;
      if (delta) {
        stopReason = (delta.stop_reason as string) || "";
      }
      const usage = d.usage as Record<string, number>;
      if (usage) outputTokens = usage.output_tokens || 0;
    }
  }

  return { model, text, thinking, inputTokens, outputTokens, stopReason };
}

/** Extract structured info from request body JSON. */
function parseRequestBody(body: string): {
  model: string;
  messages: { role: string; content: string }[];
  system: string;
  maxTokens: number;
  raw: string;
} {
  const parsed = tryParseJson(body) as Record<string, unknown> | null;
  if (!parsed) return { model: "", messages: [], system: "", maxTokens: 0, raw: body };

  const model = (parsed.model as string) || "";
  const maxTokens = (parsed.max_tokens as number) || 0;
  let system = "";
  const messages: { role: string; content: string }[] = [];

  // System prompt
  if (typeof parsed.system === "string") {
    system = parsed.system;
  } else if (Array.isArray(parsed.system)) {
    system = (parsed.system as { text?: string }[])
      .map(function (s) { return s.text || ""; })
      .join("\n");
  }

  // Messages
  if (Array.isArray(parsed.messages)) {
    for (const msg of parsed.messages as Record<string, unknown>[]) {
      const role = (msg.role as string) || "?";
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as { type?: string; text?: string }[])
          .map(function (c) { return c.text || `[${c.type || "block"}]`; })
          .join("\n");
      }
      messages.push({ role, content });
    }
  }

  return { model, messages, system, maxTokens, raw: JSON.stringify(parsed, null, 2) };
}

const sectionHeaderStyle = {
  "font-weight": "600" as const,
  color: "var(--ctp-subtext1)",
  "margin-bottom": "6px",
  "margin-top": "12px",
  "text-transform": "uppercase" as const,
  "font-size": "10px",
  "letter-spacing": "0.05em",
};

const codeBlockStyle = {
  margin: "0",
  padding: "8px",
  background: "var(--ctp-mantle)",
  "border-radius": "4px",
  "font-family": "var(--font-mono)",
  "font-size": "11px",
  "line-height": "1.5",
  color: "var(--ctp-text)",
  "white-space": "pre-wrap" as const,
  "word-break": "break-word" as const,
  "max-height": "300px",
  overflow: "auto",
};

const labelStyle = {
  display: "inline-block",
  padding: "1px 6px",
  "border-radius": "3px",
  "font-size": "10px",
  "font-weight": "600" as const,
  "margin-right": "6px",
};

export default function RequestDetail(props: RequestDetailProps) {
  const [tab, setTab] = createSignal<Tab>("response");
  const [showRawResponse, setShowRawResponse] = createSignal(false);
  const [showRawRequest, setShowRawRequest] = createSignal(false);

  const tabs: { id: Tab; label: string }[] = [
    { id: "response", label: "Response" },
    { id: "request", label: "Request" },
    { id: "headers", label: "Headers" },
  ];

  const isSse = createMemo(function () {
    return props.request.responseBody.includes("event: ");
  });

  const responseContent = createMemo(function () {
    if (isSse()) return extractResponseContent(props.request.responseBody);
    return null;
  });

  const requestParsed = createMemo(function () {
    return parseRequestBody(props.request.requestBody);
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "border-top": "1px solid var(--ctp-surface1)",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: "0",
          "border-bottom": "1px solid var(--ctp-surface0)",
          background: "var(--ctp-mantle)",
        }}
      >
        <For each={tabs}>
          {(t) => (
            <button
              onClick={() => setTab(t.id)}
              style={{
                padding: "6px 16px",
                background: "none",
                border: "none",
                "border-bottom":
                  tab() === t.id
                    ? "2px solid var(--ctp-blue)"
                    : "2px solid transparent",
                color:
                  tab() === t.id
                    ? "var(--ctp-text)"
                    : "var(--ctp-overlay1)",
                "font-size": "12px",
                cursor: "pointer",
                transition: "color 150ms ease",
              }}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>

      {/* Tab content */}
      <div style={{ flex: "1", overflow: "auto", padding: "12px" }}>
        {/* ===== RESPONSE TAB ===== */}
        <Show when={tab() === "response"}>
          <Show
            when={isSse() && responseContent() && !showRawResponse()}
            fallback={
              <pre style={codeBlockStyle}>
                {(() => {
                  const parsed = tryParseJson(props.request.responseBody);
                  return parsed
                    ? JSON.stringify(parsed, null, 2)
                    : props.request.responseBody;
                })()}
              </pre>
            }
          >
            {/* Structured SSE response view */}
            <div style={{ "font-size": "12px" }}>
              {/* Summary bar */}
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  "align-items": "center",
                  "flex-wrap": "wrap",
                  "margin-bottom": "8px",
                }}
              >
                <span
                  style={{
                    ...labelStyle,
                    background: "var(--ctp-blue)",
                    color: "var(--ctp-base)",
                  }}
                >
                  {responseContent()!.model || "?"}
                </span>
                <span
                  style={{
                    ...labelStyle,
                    background: "var(--ctp-surface1)",
                    color: "var(--ctp-text)",
                  }}
                >
                  {responseContent()!.inputTokens} in
                </span>
                <span
                  style={{
                    ...labelStyle,
                    background: "var(--ctp-surface1)",
                    color: "var(--ctp-text)",
                  }}
                >
                  {responseContent()!.outputTokens} out
                </span>
                <Show when={responseContent()!.stopReason}>
                  <span
                    style={{
                      ...labelStyle,
                      background:
                        responseContent()!.stopReason === "end_turn"
                          ? "var(--ctp-green)"
                          : "var(--ctp-yellow)",
                      color: "var(--ctp-base)",
                    }}
                  >
                    {responseContent()!.stopReason}
                  </span>
                </Show>
                <button
                  onClick={() => setShowRawResponse(true)}
                  style={{
                    "margin-left": "auto",
                    padding: "2px 8px",
                    background: "var(--ctp-surface0)",
                    border: "1px solid var(--ctp-surface1)",
                    "border-radius": "3px",
                    color: "var(--ctp-overlay1)",
                    "font-size": "10px",
                    cursor: "pointer",
                  }}
                >
                  Raw
                </button>
              </div>

              {/* Thinking block */}
              <Show when={responseContent()!.thinking}>
                <div style={sectionHeaderStyle}>Thinking</div>
                <pre
                  style={{
                    ...codeBlockStyle,
                    "border-left": "3px solid var(--ctp-mauve)",
                    color: "var(--ctp-subtext0)",
                  }}
                >
                  {responseContent()!.thinking}
                </pre>
              </Show>

              {/* Text response */}
              <Show when={responseContent()!.text}>
                <div style={sectionHeaderStyle}>Response</div>
                <pre style={codeBlockStyle}>{responseContent()!.text}</pre>
              </Show>
            </div>
          </Show>
        </Show>

        {/* ===== REQUEST TAB ===== */}
        <Show when={tab() === "request"}>
          <Show
            when={requestParsed().model && !showRawRequest()}
            fallback={
              <pre style={codeBlockStyle}>{requestParsed().raw}</pre>
            }
          >
            <div style={{ "font-size": "12px" }}>
              {/* Summary bar */}
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  "align-items": "center",
                  "flex-wrap": "wrap",
                  "margin-bottom": "8px",
                }}
              >
                <span
                  style={{
                    ...labelStyle,
                    background: "var(--ctp-blue)",
                    color: "var(--ctp-base)",
                  }}
                >
                  {requestParsed().model}
                </span>
                <Show when={requestParsed().maxTokens > 0}>
                  <span
                    style={{
                      ...labelStyle,
                      background: "var(--ctp-surface1)",
                      color: "var(--ctp-text)",
                    }}
                  >
                    max {requestParsed().maxTokens} tokens
                  </span>
                </Show>
                <span
                  style={{
                    ...labelStyle,
                    background: "var(--ctp-surface1)",
                    color: "var(--ctp-text)",
                  }}
                >
                  {requestParsed().messages.length} messages
                </span>
                <button
                  onClick={() => setShowRawRequest(true)}
                  style={{
                    "margin-left": "auto",
                    padding: "2px 8px",
                    background: "var(--ctp-surface0)",
                    border: "1px solid var(--ctp-surface1)",
                    "border-radius": "3px",
                    color: "var(--ctp-overlay1)",
                    "font-size": "10px",
                    cursor: "pointer",
                  }}
                >
                  Raw
                </button>
              </div>

              {/* System prompt */}
              <Show when={requestParsed().system}>
                <div style={sectionHeaderStyle}>System Prompt</div>
                <pre
                  style={{
                    ...codeBlockStyle,
                    "border-left": "3px solid var(--ctp-peach)",
                    "max-height": "150px",
                  }}
                >
                  {requestParsed().system}
                </pre>
              </Show>

              {/* Messages */}
              <div style={sectionHeaderStyle}>
                Messages ({requestParsed().messages.length})
              </div>
              <For each={requestParsed().messages}>
                {(msg) => (
                  <div style={{ "margin-bottom": "8px" }}>
                    <span
                      style={{
                        ...labelStyle,
                        background:
                          msg.role === "user"
                            ? "var(--ctp-green)"
                            : msg.role === "assistant"
                              ? "var(--ctp-blue)"
                              : "var(--ctp-surface1)",
                        color:
                          msg.role === "user" || msg.role === "assistant"
                            ? "var(--ctp-base)"
                            : "var(--ctp-text)",
                      }}
                    >
                      {msg.role}
                    </span>
                    <pre
                      style={{
                        ...codeBlockStyle,
                        "margin-top": "4px",
                        "max-height": "200px",
                      }}
                    >
                      {msg.content}
                    </pre>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>

        {/* ===== HEADERS TAB ===== */}
        <Show when={tab() === "headers"}>
          <div style={{ "font-size": "12px" }}>
            <div style={sectionHeaderStyle}>Request Headers</div>
            <For each={props.request.requestHeaders}>
              {([name, value]) => (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    padding: "3px 0",
                    "font-family": "var(--font-mono)",
                    "font-size": "11px",
                    "border-bottom": "1px solid var(--ctp-surface0)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--ctp-blue)",
                      "min-width": "180px",
                      "flex-shrink": "0",
                    }}
                  >
                    {name}
                  </span>
                  <span
                    style={{
                      color: "var(--ctp-subtext0)",
                      "word-break": "break-all",
                    }}
                  >
                    {value}
                  </span>
                </div>
              )}
            </For>

            <div style={{ ...sectionHeaderStyle, "margin-top": "16px" }}>
              Response Headers
            </div>
            <For each={props.request.responseHeaders}>
              {([name, value]) => (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    padding: "3px 0",
                    "font-family": "var(--font-mono)",
                    "font-size": "11px",
                    "border-bottom": "1px solid var(--ctp-surface0)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--ctp-blue)",
                      "min-width": "180px",
                      "flex-shrink": "0",
                    }}
                  >
                    {name}
                  </span>
                  <span
                    style={{
                      color: "var(--ctp-subtext0)",
                      "word-break": "break-all",
                    }}
                  >
                    {value}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
