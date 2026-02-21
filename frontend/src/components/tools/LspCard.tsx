import { Show } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface LspCardProps {
  operation: string;
  filePath: string;
  line?: number;
  result?: string;
  isError?: boolean;
}

export default function LspCard(props: LspCardProps) {
  return (
    <ToolCardBase toolName="LSP" isError={props.isError}>
      <div
        style={{
          display: "flex",
          gap: "8px",
          "align-items": "center",
          "margin-bottom": "6px",
          "font-size": "11px",
        }}
      >
        <span
          style={{
            padding: "1px 6px",
            "border-radius": "4px",
            background: "rgba(203, 166, 247, 0.15)",
            color: "var(--ctp-mauve)",
            "font-weight": "600",
            "font-size": "10px",
          }}
        >
          {props.operation}
        </span>
        <span
          style={{
            "font-family": "var(--font-mono)",
            color: "var(--ctp-blue)",
          }}
        >
          {props.filePath}
          <Show when={props.line}>
            <span style={{ color: "var(--ctp-overlay0)" }}>
              :{props.line}
            </span>
          </Show>
        </span>
      </div>
      <Show when={props.result}>
        <pre
          style={{
            margin: "0",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            color: "var(--ctp-subtext0)",
            "white-space": "pre-wrap",
            "max-height": "200px",
            overflow: "auto",
          }}
        >
          {props.result}
        </pre>
      </Show>
    </ToolCardBase>
  );
}
