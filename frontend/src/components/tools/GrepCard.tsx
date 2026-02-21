import { Show, For } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface GrepCardProps {
  pattern: string;
  results?: string;
  isError?: boolean;
}

export default function GrepCard(props: GrepCardProps) {
  const lines = () => (props.results ?? "").split("\n").filter((l) => l);

  return (
    <ToolCardBase toolName="Grep" isError={props.isError}>
      <div
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "11px",
          color: "var(--ctp-yellow)",
          "margin-bottom": "6px",
        }}
      >
        /{props.pattern}/
      </div>
      <Show when={lines().length > 0}>
        <div
          style={{
            background: "var(--ctp-crust)",
            "border-radius": "6px",
            padding: "6px 10px",
            "max-height": "300px",
            overflow: "auto",
          }}
        >
          <For each={lines()}>
            {(line) => (
              <div
                style={{
                  "font-family": "var(--font-mono)",
                  "font-size": "11px",
                  color: "var(--ctp-subtext0)",
                  padding: "1px 0",
                  "white-space": "pre-wrap",
                  "word-break": "break-word",
                }}
              >
                {line}
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={lines().length > 0}>
        <div
          style={{
            "margin-top": "4px",
            "font-size": "10px",
            color: "var(--ctp-overlay0)",
          }}
        >
          {lines().length} matches
        </div>
      </Show>
    </ToolCardBase>
  );
}
