import { createSignal, Show, For } from "solid-js";
import type { ContentBlock } from "../../types/messages";

interface ToolCardProps {
  blocks: ContentBlock[];
}

export default function ToolCard(props: ToolCardProps) {
  const toolUse = () => props.blocks.find((b) => b.type === "tool_use");
  const toolResult = () => props.blocks.find((b) => b.type === "tool_result");
  const [expanded, setExpanded] = createSignal(false);

  const toolName = () => toolUse()?.name ?? "tool";
  const isError = () => toolResult()?.is_error === true;

  const inputText = () => {
    const input = toolUse()?.input;
    if (!input) return "";
    return typeof input === "string" ? input : JSON.stringify(input, null, 2);
  };

  const resultText = () => toolResult()?.content ?? "";

  return (
    <div
      style={{
        margin: "4px 16px",
        "border-radius": "8px",
        border: `1px solid ${isError() ? "var(--ctp-red)" : "var(--ctp-surface1)"}`,
        background: "var(--ctp-surface0)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded())}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          width: "100%",
          padding: "8px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: isError() ? "var(--ctp-red)" : "var(--ctp-peach)",
          "font-size": "12px",
          "font-weight": "600",
          "text-align": "left",
        }}
      >
        <span
          style={{
            transform: expanded() ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
            display: "inline-block",
          }}
        >
          {"\u25B6"}
        </span>
        <span
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "12px",
          }}
        >
          {toolName()}
        </span>
        <Show when={isError()}>
          <span
            style={{
              "font-size": "10px",
              padding: "1px 6px",
              "border-radius": "4px",
              background: "rgba(243, 139, 168, 0.15)",
              color: "var(--ctp-red)",
            }}
          >
            error
          </span>
        </Show>
      </button>

      <Show when={expanded()}>
        <div
          style={{
            "border-top": "1px solid var(--ctp-surface1)",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            "line-height": "1.5",
          }}
        >
          <Show when={inputText()}>
            <div style={{ padding: "8px 12px" }}>
              <div
                style={{
                  "font-size": "10px",
                  color: "var(--ctp-overlay0)",
                  "font-weight": "600",
                  "text-transform": "uppercase",
                  "margin-bottom": "4px",
                  "font-family": "var(--font-sans)",
                }}
              >
                input
              </div>
              <pre
                style={{
                  margin: "0",
                  "white-space": "pre-wrap",
                  "word-break": "break-word",
                  color: "var(--ctp-subtext0)",
                  "max-height": "300px",
                  overflow: "auto",
                }}
              >
                {inputText()}
              </pre>
            </div>
          </Show>
          <Show when={resultText()}>
            <div
              style={{
                padding: "8px 12px",
                "border-top": "1px solid var(--ctp-surface1)",
              }}
            >
              <div
                style={{
                  "font-size": "10px",
                  color: isError()
                    ? "var(--ctp-red)"
                    : "var(--ctp-overlay0)",
                  "font-weight": "600",
                  "text-transform": "uppercase",
                  "margin-bottom": "4px",
                  "font-family": "var(--font-sans)",
                }}
              >
                {isError() ? "error" : "output"}
              </div>
              <pre
                style={{
                  margin: "0",
                  "white-space": "pre-wrap",
                  "word-break": "break-word",
                  color: isError()
                    ? "var(--ctp-red)"
                    : "var(--ctp-subtext0)",
                  "max-height": "300px",
                  overflow: "auto",
                }}
              >
                {resultText()}
              </pre>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
