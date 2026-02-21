import { Show } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface PdfCardProps {
  filePath: string;
  pages?: string;
  content?: string;
  isError?: boolean;
}

export default function PdfCard(props: PdfCardProps) {
  const preview = () => {
    const c = props.content ?? "";
    return c.length > 500 ? c.slice(0, 500) + "..." : c;
  };

  return (
    <ToolCardBase toolName="Read" isError={props.isError}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "margin-bottom": "6px",
          "font-size": "11px",
        }}
      >
        <span
          style={{
            padding: "1px 6px",
            "border-radius": "4px",
            background: "rgba(250, 179, 135, 0.15)",
            color: "var(--ctp-peach)",
            "font-weight": "600",
            "font-size": "10px",
          }}
        >
          PDF
        </span>
        <span
          style={{
            "font-family": "var(--font-mono)",
            color: "var(--ctp-blue)",
          }}
        >
          {props.filePath}
        </span>
        <Show when={props.pages}>
          <span style={{ color: "var(--ctp-overlay0)" }}>
            pp. {props.pages}
          </span>
        </Show>
      </div>
      <Show when={preview()}>
        <pre
          style={{
            margin: "0",
            "font-size": "11px",
            "line-height": "1.5",
            color: "var(--ctp-subtext0)",
            "white-space": "pre-wrap",
            "word-break": "break-word",
            "max-height": "200px",
            overflow: "auto",
          }}
        >
          {preview()}
        </pre>
      </Show>
    </ToolCardBase>
  );
}
