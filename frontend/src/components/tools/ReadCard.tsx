import { Show } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface ReadCardProps {
  filePath: string;
  content?: string;
  isError?: boolean;
}

export default function ReadCard(props: ReadCardProps) {
  return (
    <ToolCardBase toolName="Read" isError={props.isError}>
      <div
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "11px",
          color: "var(--ctp-blue)",
          "margin-bottom": "6px",
        }}
      >
        {props.filePath}
      </div>
      <Show when={props.content}>
        <pre
          style={{
            margin: "0",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            "line-height": "1.5",
            color: "var(--ctp-subtext0)",
            background: "var(--ctp-crust)",
            "border-radius": "6px",
            padding: "8px 10px",
            "max-height": "300px",
            overflow: "auto",
            "white-space": "pre-wrap",
            "word-break": "break-word",
          }}
        >
          {props.content}
        </pre>
      </Show>
    </ToolCardBase>
  );
}
