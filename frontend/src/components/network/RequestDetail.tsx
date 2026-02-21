import { createSignal, Show, For } from "solid-js";
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

export default function RequestDetail(props: RequestDetailProps) {
  const [tab, setTab] = createSignal<Tab>("response");

  const tabs: { id: Tab; label: string }[] = [
    { id: "response", label: "Response" },
    { id: "request", label: "Request" },
    { id: "headers", label: "Headers" },
  ];

  function tryFormatJson(text: string): string {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

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
      <div
        style={{
          flex: "1",
          overflow: "auto",
          padding: "12px",
        }}
      >
        <Show when={tab() === "response"}>
          <pre
            style={{
              margin: "0",
              "font-family": "var(--font-mono)",
              "font-size": "11px",
              "line-height": "1.5",
              color: "var(--ctp-text)",
              "white-space": "pre-wrap",
              "word-break": "break-word",
            }}
          >
            {tryFormatJson(props.request.responseBody)}
          </pre>
        </Show>

        <Show when={tab() === "request"}>
          <pre
            style={{
              margin: "0",
              "font-family": "var(--font-mono)",
              "font-size": "11px",
              "line-height": "1.5",
              color: "var(--ctp-text)",
              "white-space": "pre-wrap",
              "word-break": "break-word",
            }}
          >
            {tryFormatJson(props.request.requestBody)}
          </pre>
        </Show>

        <Show when={tab() === "headers"}>
          <div style={{ "font-size": "12px" }}>
            <div
              style={{
                "font-weight": "600",
                color: "var(--ctp-subtext1)",
                "margin-bottom": "8px",
                "text-transform": "uppercase",
                "font-size": "10px",
                "letter-spacing": "0.05em",
              }}
            >
              Request Headers
            </div>
            <For each={props.request.requestHeaders}>
              {([name, value]) => (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    padding: "2px 0",
                    "font-family": "var(--font-mono)",
                    "font-size": "11px",
                    "border-bottom":
                      "1px solid var(--ctp-surface0)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--ctp-blue)",
                      "min-width": "140px",
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

            <div
              style={{
                "font-weight": "600",
                color: "var(--ctp-subtext1)",
                "margin-top": "16px",
                "margin-bottom": "8px",
                "text-transform": "uppercase",
                "font-size": "10px",
                "letter-spacing": "0.05em",
              }}
            >
              Response Headers
            </div>
            <For each={props.request.responseHeaders}>
              {([name, value]) => (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    padding: "2px 0",
                    "font-family": "var(--font-mono)",
                    "font-size": "11px",
                    "border-bottom":
                      "1px solid var(--ctp-surface0)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--ctp-blue)",
                      "min-width": "140px",
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
