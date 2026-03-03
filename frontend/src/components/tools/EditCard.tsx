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

/** Compute an inline unified diff between old and new strings.
 *  Uses LCS to interleave deletions and additions (like `git diff`). */
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

  // Changed middle sections
  const oldMiddle = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const newMiddle = newLines.slice(prefixLen, newLines.length - suffixLen);

  // LCS-based interleaved diff for the changed section
  lcsDiff(oldMiddle, newMiddle, lines);

  // Context: show first 3 suffix lines
  const ctxAfter = Math.min(suffixLen, 3);
  for (let i = 0; i < ctxAfter; i++) {
    lines.push({ type: "ctx", text: oldLines[oldLines.length - suffixLen + i] });
  }

  return lines;
}

/** LCS-based diff: interleaves del/add around common lines. */
function lcsDiff(a: string[], b: string[], out: DiffLine[]) {
  const m = a.length;
  const n = b.length;

  if (m === 0) {
    for (const line of b) out.push({ type: "add", text: line });
    return;
  }
  if (n === 0) {
    for (const line of a) out.push({ type: "del", text: line });
    return;
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce interleaved diff (build in reverse, then flip)
  const stack: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ type: "ctx", text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "add", text: b[j - 1] });
      j--;
    } else {
      stack.push({ type: "del", text: a[i - 1] });
      i--;
    }
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    out.push(stack[k]);
  }
}

const PREVIEW_LINES = 12;

export default function EditCard(props: EditCardProps) {
  const diffLines = createMemo(() => {
    if (!props.oldString && !props.newString) return [];
    if (!props.oldString && props.newString) {
      return props.newString.split("\n").map((line): DiffLine => ({ type: "add", text: line }));
    }
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

  const isTruncated = createMemo(() => diffLines().length > PREVIEW_LINES);
  const previewLines = createMemo(() =>
    isTruncated() ? diffLines().slice(0, PREVIEW_LINES) : diffLines(),
  );

  const renderDiffLine = (line: DiffLine) => (
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
  );

  // Preview: file path + stats + truncated diff (always visible)
  const preview = (
    <div style={{ "font-family": "var(--font-mono)", "font-size": "12px", overflow: "hidden" }}>
      {/* File path header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "10px",
          padding: "6px 10px",
          "border-bottom": diffLines().length > 0 ? "1px solid var(--ctp-surface0)" : "none",
        }}
      >
        <span
          style={{
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
          <div style={{ display: "flex", gap: "8px", "font-size": "10px", "flex-shrink": "0" }}>
            <Show when={stats().adds > 0}>
              <span style={{ color: "var(--neon-green, #00ff9d)" }}>+{stats().adds}</span>
            </Show>
            <Show when={stats().dels > 0}>
              <span style={{ color: "var(--ctp-red, #ff4444)" }}>-{stats().dels}</span>
            </Show>
          </div>
        </Show>
      </div>

      {/* Truncated diff preview */}
      <Show when={previewLines().length > 0}>
        <div style={{ position: "relative" }}>
          <div class="diff-block" style={{ margin: "0", border: "none", "border-radius": "0", "box-shadow": "none", "max-height": "240px", overflow: "hidden" }}>
            <For each={previewLines()}>
              {renderDiffLine}
            </For>
          </div>
          <Show when={isTruncated()}>
            <div
              style={{
                position: "absolute",
                bottom: "0",
                left: "0",
                right: "0",
                height: "24px",
                background: "linear-gradient(to top, var(--ctp-crust), transparent)",
                "pointer-events": "none",
              }}
            />
            <div
              style={{
                padding: "2px 10px 4px",
                "font-size": "10px",
                color: "var(--dim, #68687a)",
                "letter-spacing": "0.02em",
              }}
            >
              {diffLines().length} lines total
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );

  return (
    <ToolCardBase toolName="Edit" isError={props.isError} preview={preview}>
      {/* Full diff (shown when expanded, only if truncated) */}
      <Show when={isTruncated()}>
        <div
          class="diff-block"
          style={{ margin: "0", "max-height": "600px", overflow: "auto" }}
        >
          <For each={diffLines()}>
            {renderDiffLine}
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
