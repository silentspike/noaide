import { Show, createMemo } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface BashCardProps {
  command: string;
  description?: string;
  output?: string;
  exitCode?: number;
  isError?: boolean;
  executionMs?: number;
}

const TAIL_LINES = 10;

export default function BashCard(props: BashCardProps) {
  const outputLines = createMemo(() => {
    if (!props.output) return [];
    return props.output.split("\n");
  });

  const isTruncated = createMemo(() => outputLines().length > TAIL_LINES);

  const tailOutput = createMemo(() => {
    const lines = outputLines();
    if (lines.length <= TAIL_LINES) return props.output ?? "";
    return lines.slice(-TAIL_LINES).join("\n");
  });

  const totalLines = createMemo(() => outputLines().length);

  // Preview: command prompt + last N lines (always visible)
  const preview = (
    <div
      style={{
        "font-family": "var(--font-mono)",
        "font-size": "12px",
        background: "var(--ctp-crust)",
        overflow: "hidden",
      }}
    >
      {/* Command prompt */}
      <div
        style={{
          padding: "6px 10px",
          color: "var(--ctp-green)",
          "white-space": "pre-wrap",
          "word-break": "break-all",
          "border-bottom": props.output ? "1px solid var(--ctp-surface0)" : "none",
        }}
      >
        <span style={{ color: "var(--ctp-blue)", "user-select": "none" }}>$ </span>{props.command}
      </div>

      {/* Tail output (last N lines) */}
      <Show when={props.output}>
        <div style={{ position: "relative" }}>
          <Show when={isTruncated()}>
            <div
              style={{
                position: "absolute",
                top: "0",
                left: "0",
                right: "0",
                height: "20px",
                background: "linear-gradient(to bottom, var(--ctp-crust), transparent)",
                "pointer-events": "none",
                "z-index": "1",
              }}
            />
          </Show>
          <pre
            style={{
              margin: "0",
              padding: isTruncated() ? "16px 10px 6px" : "6px 10px",
              color: props.isError ? "var(--ctp-red)" : "var(--ctp-text)",
              "white-space": "pre-wrap",
              "word-break": "break-word",
              "line-height": "1.5",
              "font-size": "12px",
              "max-height": "200px",
              overflow: "hidden",
            }}
          >
            {tailOutput()}
          </pre>
          <Show when={isTruncated()}>
            <div
              style={{
                padding: "2px 10px 4px",
                "font-size": "10px",
                color: "var(--dim, #68687a)",
                "letter-spacing": "0.02em",
              }}
            >
              {totalLines()} lines total
            </div>
          </Show>
        </div>
      </Show>

      {/* Exit code indicator */}
      <Show when={props.exitCode != null && props.exitCode !== 0}>
        <div
          style={{
            padding: "2px 10px 4px",
            "font-size": "10px",
            color: "var(--ctp-red)",
          }}
        >
          exit {props.exitCode}
        </div>
      </Show>
    </div>
  );

  return (
    <ToolCardBase
      toolName="Bash"
      isError={props.isError}
      executionMs={props.executionMs}
      preview={preview}
    >
      {/* Full output (shown when expanded) */}
      <Show when={props.description}>
        <div
          style={{
            "font-size": "11px",
            color: "var(--ctp-subtext0)",
            "margin-bottom": "6px",
            "font-style": "italic",
          }}
        >
          {props.description}
        </div>
      </Show>
      <Show when={props.output && isTruncated()}>
        <div
          style={{
            background: "var(--ctp-crust)",
            "border-radius": "6px",
            overflow: "hidden",
            border: "1px solid var(--ctp-surface0)",
          }}
        >
          <pre
            style={{
              margin: "0",
              padding: "8px 10px",
              "font-family": "var(--font-mono)",
              "font-size": "12px",
              color: props.isError ? "var(--ctp-red)" : "var(--ctp-text)",
              "white-space": "pre-wrap",
              "word-break": "break-word",
              "line-height": "1.5",
              "max-height": "600px",
              overflow: "auto",
            }}
          >
            {props.output}
          </pre>
        </div>
      </Show>
    </ToolCardBase>
  );
}
