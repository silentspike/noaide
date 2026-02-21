import { Show } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface NotebookCardProps {
  cellType: string;
  content?: string;
  isError?: boolean;
}

export default function NotebookCard(props: NotebookCardProps) {
  return (
    <ToolCardBase toolName="NotebookEdit" isError={props.isError}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          "margin-bottom": "6px",
          "font-size": "11px",
        }}
      >
        <span
          style={{
            padding: "1px 6px",
            "border-radius": "4px",
            background:
              props.cellType === "code"
                ? "rgba(137, 180, 250, 0.15)"
                : "rgba(245, 194, 231, 0.15)",
            color:
              props.cellType === "code"
                ? "var(--ctp-blue)"
                : "var(--ctp-pink)",
            "font-weight": "600",
            "font-size": "10px",
          }}
        >
          {props.cellType}
        </span>
      </div>
      <Show when={props.content}>
        <pre
          style={{
            margin: "0",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            color: "var(--ctp-subtext0)",
            background: "var(--ctp-crust)",
            "border-radius": "6px",
            padding: "8px 10px",
            "white-space": "pre-wrap",
            "max-height": "200px",
            overflow: "auto",
          }}
        >
          {props.content}
        </pre>
      </Show>
    </ToolCardBase>
  );
}
