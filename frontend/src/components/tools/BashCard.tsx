import { Show } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface BashCardProps {
  command: string;
  output?: string;
  exitCode?: number;
  isError?: boolean;
  executionMs?: number;
}

export default function BashCard(props: BashCardProps) {
  return (
    <ToolCardBase
      toolName="Bash"
      isError={props.isError}
      executionMs={props.executionMs}
    >
      <div
        style={{
          background: "var(--ctp-crust)",
          "border-radius": "6px",
          padding: "8px 10px",
          "font-family": "var(--font-mono)",
          "font-size": "11px",
          "max-height": "400px",
          overflow: "auto",
        }}
      >
        <div
          style={{
            color: "var(--ctp-green)",
            "margin-bottom": "4px",
          }}
        >
          $ {props.command}
        </div>
        <Show when={props.output}>
          <pre
            style={{
              margin: "0",
              color: "var(--ctp-subtext0)",
              "white-space": "pre-wrap",
              "word-break": "break-word",
            }}
          >
            {props.output}
          </pre>
        </Show>
      </div>
      <Show when={props.exitCode != null && props.exitCode !== 0}>
        <div
          style={{
            "margin-top": "4px",
            "font-size": "10px",
            color: "var(--ctp-red)",
          }}
        >
          exit code: {props.exitCode}
        </div>
      </Show>
    </ToolCardBase>
  );
}
