import { Show } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface WebSearchCardProps {
  query: string;
  results?: string;
  isError?: boolean;
}

export default function WebSearchCard(props: WebSearchCardProps) {
  return (
    <ToolCardBase toolName="WebSearch" isError={props.isError}>
      <div
        style={{
          "font-size": "12px",
          color: "var(--ctp-sapphire)",
          "margin-bottom": "6px",
        }}
      >
        Search: {props.query}
      </div>
      <Show when={props.results}>
        <pre
          style={{
            margin: "0",
            "font-size": "11px",
            "line-height": "1.5",
            color: "var(--ctp-subtext0)",
            "white-space": "pre-wrap",
            "word-break": "break-word",
            "max-height": "300px",
            overflow: "auto",
          }}
        >
          {props.results}
        </pre>
      </Show>
    </ToolCardBase>
  );
}
