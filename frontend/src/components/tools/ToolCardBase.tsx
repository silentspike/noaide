import { createSignal, Show, type JSX } from "solid-js";

interface ToolCardBaseProps {
  toolName: string;
  isError?: boolean;
  executionMs?: number;
  children: JSX.Element;
  defaultExpanded?: boolean;
}

function toolColor(name: string): string {
  const colors: Record<string, string> = {
    Edit: "var(--ctp-green)",
    Bash: "var(--ctp-peach)",
    Read: "var(--ctp-blue)",
    Grep: "var(--ctp-yellow)",
    Glob: "var(--ctp-teal)",
    Write: "var(--ctp-green)",
    WebSearch: "var(--ctp-sapphire)",
    WebFetch: "var(--ctp-sapphire)",
    LSP: "var(--ctp-mauve)",
    NotebookEdit: "var(--ctp-pink)",
    AskUserQuestion: "var(--ctp-flamingo)",
  };
  return colors[name] ?? "var(--ctp-peach)";
}

export default function ToolCardBase(props: ToolCardBaseProps) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);

  return (
    <div
      style={{
        margin: "4px 16px",
        "border-radius": "8px",
        border: `1px solid ${props.isError ? "var(--ctp-red)" : "var(--ctp-surface1)"}`,
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
          color: props.isError ? "var(--ctp-red)" : toolColor(props.toolName),
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
            "font-size": "10px",
          }}
        >
          {"\u25B6"}
        </span>
        <span style={{ "font-family": "var(--font-mono)" }}>
          {props.toolName}
        </span>
        <Show when={props.isError}>
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
        <Show when={props.executionMs}>
          <span
            style={{
              "margin-left": "auto",
              "font-size": "10px",
              color: "var(--ctp-overlay0)",
              "font-weight": "400",
            }}
          >
            {props.executionMs!}ms
          </span>
        </Show>
      </button>
      <Show when={expanded()}>
        <div
          style={{
            "border-top": "1px solid var(--ctp-surface1)",
            padding: "8px 12px",
          }}
        >
          {props.children}
        </div>
      </Show>
    </div>
  );
}
