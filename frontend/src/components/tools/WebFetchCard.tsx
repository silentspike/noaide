import { Show } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface WebFetchCardProps {
  url: string;
  content?: string;
  isError?: boolean;
}

export default function WebFetchCard(props: WebFetchCardProps) {
  const preview = () => {
    const c = props.content ?? "";
    return c.length > 500 ? c.slice(0, 500) + "..." : c;
  };

  return (
    <ToolCardBase toolName="WebFetch" isError={props.isError}>
      <div
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "11px",
          color: "var(--ctp-sapphire)",
          "margin-bottom": "6px",
          "word-break": "break-all",
        }}
      >
        {props.url}
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
