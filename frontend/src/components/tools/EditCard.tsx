import { Show, For, createMemo } from "solid-js";
import ToolCardBase from "./ToolCardBase";

interface EditCardProps {
  filePath: string;
  oldString?: string;
  newString?: string;
  isError?: boolean;
  result?: string;
}

interface DiffLine {
  type: "ctx" | "del" | "add";
  text: string;
}

/** Compute a simple unified diff between old and new strings.
 *  Finds common prefix/suffix lines, marks the middle as deletions/additions. */
function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const lines: DiffLine[] = [];

  // Find common prefix
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  // Find common suffix (don't overlap with prefix)
  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Context: show last 3 prefix lines
  const ctxBefore = Math.max(0, prefixLen - 3);
  for (let i = ctxBefore; i < prefixLen; i++) {
    lines.push({ type: "ctx", text: oldLines[i] });
  }

  // Deletions (middle of old)
  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    lines.push({ type: "del", text: oldLines[i] });
  }

  // Additions (middle of new)
  for (let i = prefixLen; i < newLines.length - suffixLen; i++) {
    lines.push({ type: "add", text: newLines[i] });
  }

  // Context: show first 3 suffix lines
  const ctxAfter = Math.min(suffixLen, 3);
  for (let i = 0; i < ctxAfter; i++) {
    lines.push({ type: "ctx", text: oldLines[oldLines.length - suffixLen + i] });
  }

  return lines;
}

export default function EditCard(props: EditCardProps) {
  const diffLines = createMemo(() => {
    if (!props.oldString && !props.newString) return [];
    // Pure addition (no old string)
    if (!props.oldString && props.newString) {
      return props.newString.split("\n").map((line): DiffLine => ({ type: "add", text: line }));
    }
    // Pure deletion (no new string)
    if (props.oldString && !props.newString) {
      return props.oldString.split("\n").map((line): DiffLine => ({ type: "del", text: line }));
    }
    return computeDiff(props.oldString!, props.newString!);
  });

  const stats = createMemo(() => {
    let adds = 0;
    let dels = 0;
    for (const line of diffLines()) {
      if (line.type === "add") adds++;
      if (line.type === "del") dels++;
    }
    return { adds, dels };
  });

  return (
    <ToolCardBase toolName="Edit" isError={props.isError}>
      {/* File path + stats */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "10px",
          "margin-bottom": "8px",
        }}
      >
        <span
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            color: "var(--neon-blue, #00b8ff)",
            flex: "1",
            "min-width": "0",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.filePath}
        </span>
        <Show when={stats().adds > 0 || stats().dels > 0}>
          <div
            style={{
              display: "flex",
              gap: "8px",
              "font-family": "var(--font-mono)",
              "font-size": "10px",
              "flex-shrink": "0",
            }}
          >
            <Show when={stats().adds > 0}>
              <span style={{ color: "var(--neon-green, #00ff9d)" }}>
                +{stats().adds}
              </span>
            </Show>
            <Show when={stats().dels > 0}>
              <span style={{ color: "var(--ctp-red, #ff4444)" }}>
                -{stats().dels}
              </span>
            </Show>
          </div>
        </Show>
      </div>

      {/* Diff view */}
      <Show when={diffLines().length > 0}>
        <div class="diff-block" style={{ margin: "0" }}>
          <For each={diffLines()}>
            {(line) => (
              <div
                class={
                  line.type === "add"
                    ? "diff-add"
                    : line.type === "del"
                      ? "diff-del"
                      : "diff-ctx"
                }
              >
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "} {line.text}
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Result message */}
      <Show when={props.result}>
        <pre
          style={{
            margin: "6px 0 0",
            "font-family": "var(--font-mono)",
            "font-size": "10px",
            color: props.isError ? "var(--ctp-red)" : "var(--ctp-subtext0)",
            "white-space": "pre-wrap",
            opacity: "0.7",
          }}
        >
          {props.result}
        </pre>
      </Show>
    </ToolCardBase>
  );
}
