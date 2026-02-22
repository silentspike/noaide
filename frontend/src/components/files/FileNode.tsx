import { createSignal, Show, For } from "solid-js";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  modified?: boolean;
  children?: FileEntry[];
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  onSelect: (path: string) => void;
  selectedPath?: string;
}

function extensionIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const icons: Record<string, string> = {
    ts: "TS", tsx: "TX", js: "JS", jsx: "JX",
    rs: "RS", py: "PY", go: "GO", md: "MD",
    css: "CS", html: "HT", json: "{}", toml: "TM",
    yaml: "YM", yml: "YM", lock: "LK", sh: "SH",
  };
  return icons[ext] ?? "..";
}

export default function FileNode(props: FileNodeProps) {
  // eslint-disable-next-line solid/reactivity -- one-time init from prop
  const [expanded, setExpanded] = createSignal(props.depth < 1);
  const isSelected = () => props.selectedPath === props.entry.path;

  return (
    <div>
      <button
        onClick={() => {
          if (props.entry.isDir) {
            setExpanded(!expanded());
          } else {
            props.onSelect(props.entry.path);
          }
        }}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "4px",
          width: "100%",
          padding: `3px 8px 3px ${8 + props.depth * 16}px`,
          background: isSelected() ? "var(--ctp-surface1)" : "transparent",
          border: "none",
          cursor: "pointer",
          color: isSelected() ? "var(--ctp-text)" : "var(--ctp-subtext0)",
          "font-family": "var(--font-mono)",
          "font-size": "11px",
          "text-align": "left",
          "border-radius": "4px",
        }}
      >
        <Show when={props.entry.isDir}>
          <span
            style={{
              display: "inline-block",
              transform: expanded() ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 100ms ease",
              "font-size": "8px",
              color: "var(--ctp-overlay1)",
              width: "10px",
            }}
          >
            {"\u25B6"}
          </span>
        </Show>
        <Show when={!props.entry.isDir}>
          <span
            style={{
              "font-size": "8px",
              padding: "0 2px",
              "border-radius": "2px",
              background: "var(--ctp-surface1)",
              color: "var(--ctp-overlay1)",
              "font-weight": "600",
              "min-width": "16px",
              "text-align": "center",
            }}
          >
            {extensionIcon(props.entry.name)}
          </span>
        </Show>
        <span style={{ flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
          {props.entry.name}
        </span>
        <Show when={props.entry.modified}>
          <span
            style={{
              width: "6px",
              height: "6px",
              "border-radius": "50%",
              background: "var(--ctp-peach)",
              "flex-shrink": "0",
            }}
          />
        </Show>
      </button>
      <Show when={props.entry.isDir && expanded() && props.entry.children}>
        <For each={props.entry.children}>
          {(child) => (
            <FileNode
              entry={child}
              depth={props.depth + 1}
              onSelect={props.onSelect}
              selectedPath={props.selectedPath}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
