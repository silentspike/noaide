import { For } from "solid-js";

export interface BlameLine {
  author: string;
  timestamp: string;
  commitHash: string;
}

interface BlameGutterProps {
  lines: BlameLine[];
  visibleStart: number;
  visibleEnd: number;
}

function relativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo`;
}

function shortAuthor(author: string): string {
  return author.length > 8 ? author.slice(0, 8) : author;
}

export default function BlameGutter(props: BlameGutterProps) {
  const visibleLines = () =>
    props.lines.slice(props.visibleStart, props.visibleEnd);

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "font-family": "var(--font-mono)",
        "font-size": "10px",
        color: "var(--ctp-overlay0)",
        "user-select": "none",
        "border-right": "1px solid var(--ctp-surface0)",
        "padding-right": "4px",
        "min-width": "100px",
      }}
    >
      <For each={visibleLines()}>
        {(line, i) => {
          const prevLine = () => {
            const idx = i() + props.visibleStart - 1;
            return idx >= 0 ? props.lines[idx] : undefined;
          };
          const showInfo = () =>
            !prevLine() || prevLine()!.commitHash !== line.commitHash;

          return (
            <div
              style={{
                height: "20px",
                "line-height": "20px",
                display: "flex",
                gap: "4px",
                padding: "0 4px",
                opacity: showInfo() ? "1" : "0.3",
              }}
              title={`${line.author} ${line.timestamp} ${line.commitHash}`}
            >
              <span style={{ width: "56px", overflow: "hidden", "text-overflow": "ellipsis" }}>
                {showInfo() ? shortAuthor(line.author) : ""}
              </span>
              <span style={{ color: "var(--ctp-surface2)" }}>
                {showInfo() ? relativeTime(line.timestamp) : ""}
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}
