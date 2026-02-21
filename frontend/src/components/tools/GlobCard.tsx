import { Show, For } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface GlobCardProps {
  pattern: string;
  files?: string;
  isError?: boolean;
}

function fileIcon(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const icons: Record<string, string> = {
    ts: "TS",
    tsx: "TX",
    js: "JS",
    jsx: "JX",
    rs: "RS",
    md: "MD",
    css: "CS",
    json: "{}",
    toml: "TM",
    yaml: "YM",
    yml: "YM",
    html: "HT",
  };
  return icons[ext] ?? "..";
}

export default function GlobCard(props: GlobCardProps) {
  const fileList = () =>
    (props.files ?? "").split("\n").filter((f) => f.trim());

  return (
    <ToolCardBase toolName="Glob" isError={props.isError}>
      <div
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "11px",
          color: "var(--ctp-teal)",
          "margin-bottom": "6px",
        }}
      >
        {props.pattern}
        <span style={{ color: "var(--ctp-overlay0)", "margin-left": "8px" }}>
          {fileList().length} files
        </span>
      </div>
      <Show when={fileList().length > 0}>
        <div
          style={{
            "max-height": "200px",
            overflow: "auto",
          }}
        >
          <For each={fileList()}>
            {(file) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  padding: "2px 0",
                  "font-family": "var(--font-mono)",
                  "font-size": "11px",
                  color: "var(--ctp-subtext0)",
                }}
              >
                <span
                  style={{
                    "font-size": "9px",
                    padding: "1px 4px",
                    "border-radius": "3px",
                    background: "var(--ctp-surface1)",
                    color: "var(--ctp-overlay1)",
                    "font-weight": "600",
                    "min-width": "20px",
                    "text-align": "center",
                  }}
                >
                  {fileIcon(file)}
                </span>
                {file}
              </div>
            )}
          </For>
        </div>
      </Show>
    </ToolCardBase>
  );
}
