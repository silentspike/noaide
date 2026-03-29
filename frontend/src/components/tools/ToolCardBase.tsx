import { Show, type JSX } from "solid-js";
import { useExpanded } from "../chat/expandedContext";
import { useItemKey } from "../chat/itemKeyContext";

interface ToolCardBaseProps {
  toolName: string;
  isError?: boolean;
  executionMs?: number;
  children: JSX.Element;
  defaultExpanded?: boolean;
  /** Always-visible preview shown below header even when collapsed */
  preview?: JSX.Element;
}

function toolColor(name: string): string {
  const colors: Record<string, string> = {
    Edit: "var(--neon-green, #00ff9d)",
    Bash: "var(--ctp-peach)",
    Read: "var(--neon-blue, #00b8ff)",
    Grep: "var(--ctp-yellow)",
    Glob: "var(--accent-cyan, #06b6d4)",
    Write: "var(--neon-green, #00ff9d)",
    WebSearch: "var(--neon-blue, #00b8ff)",
    WebFetch: "var(--neon-blue, #00b8ff)",
    LSP: "var(--ctp-mauve)",
    NotebookEdit: "var(--ctp-blue)",
    Permission: "var(--ctp-red)",
    AskUserQuestion: "var(--ctp-flamingo)",
  };
  return colors[name] ?? "var(--ctp-peach)";
}

export default function ToolCardBase(props: ToolCardBaseProps) {
  const ctx = useExpanded();
  const itemKey = useItemKey();
  const defaultVal = props.defaultExpanded ?? false;
  const expanded = () =>
    ctx && itemKey
      ? ctx.isExpanded(itemKey, defaultVal)
      : defaultVal;
  const toggleExpanded = () => {
    if (ctx && itemKey) {
      ctx.toggle(itemKey);
    }
  };

  return (
    <div
      style={{
        margin: "4px 16px",
        "border-radius": "6px",
        border: `1px solid ${props.isError ? "rgba(255,68,68,0.3)" : "var(--ctp-surface1)"}`,
        background: props.isError ? "rgba(255,68,68,0.04)" : "rgba(14,14,24,0.6)",
        "backdrop-filter": "blur(8px)",
        "-webkit-backdrop-filter": "blur(8px)",
        overflow: "hidden",
        transition: "border-color 200ms ease",
      }}
    >
      <button
        onClick={toggleExpanded}
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
      <Show when={props.preview}>
        <div
          style={{
            "border-top": "1px solid rgba(37,37,53,0.4)",
            padding: "0",
          }}
        >
          {props.preview}
        </div>
      </Show>
      <Show when={expanded()}>
        <div
          style={{
            "border-top": "1px solid rgba(37,37,53,0.6)",
            padding: "8px 12px",
          }}
        >
          {props.children}
        </div>
      </Show>
    </div>
  );
}
