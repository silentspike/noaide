import { Show, For } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface EditCardProps {
  filePath: string;
  oldString?: string;
  newString?: string;
  isError?: boolean;
  result?: string;
}

export default function EditCard(props: EditCardProps) {
  const oldLines = () => (props.oldString ?? "").split("\n");
  const newLines = () => (props.newString ?? "").split("\n");

  return (
    <ToolCardBase toolName="Edit" isError={props.isError}>
      <div
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "11px",
          color: "var(--ctp-blue)",
          "margin-bottom": "8px",
        }}
      >
        {props.filePath}
      </div>
      <Show when={props.oldString || props.newString}>
        <div
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            "line-height": "1.6",
            "max-height": "300px",
            overflow: "auto",
          }}
        >
          <For each={oldLines()}>
            {(line) => (
              <div
                style={{
                  background: "rgba(243, 139, 168, 0.1)",
                  color: "var(--ctp-red)",
                  padding: "0 4px",
                }}
              >
                - {line}
              </div>
            )}
          </For>
          <For each={newLines()}>
            {(line) => (
              <div
                style={{
                  background: "rgba(166, 227, 161, 0.1)",
                  color: "var(--ctp-green)",
                  padding: "0 4px",
                }}
              >
                + {line}
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.result}>
        <pre
          style={{
            margin: "4px 0 0",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            color: props.isError ? "var(--ctp-red)" : "var(--ctp-subtext0)",
            "white-space": "pre-wrap",
          }}
        >
          {props.result}
        </pre>
      </Show>
    </ToolCardBase>
  );
}
