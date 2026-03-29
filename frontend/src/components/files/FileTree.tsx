import { createSignal, createEffect, onCleanup, Show, For } from "solid-js";
import FileNode from "./FileNode";
import { useSession, useFiles } from "../../App";
import type { FileEntry } from "../../stores/file";

type SortColumn = "name" | "size" | "files" | "modified" | "created";
type SortDir = "asc" | "desc";

interface FileTreeProps {
  onFileSelect: (path: string) => void;
}

function sortEntries(entries: FileEntry[], col: SortColumn, dir: SortDir): FileEntry[] {
  const sorted = [...entries].sort((a, b) => {
    // Directories always first, regardless of sort
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;

    let cmp = 0;
    switch (col) {
      case "name":
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      case "size":
        cmp = (a.isDir ? (a.totalSize ?? 0) : a.size) - (b.isDir ? (b.totalSize ?? 0) : b.size);
        break;
      case "files":
        cmp = (a.fileCount ?? 0) - (b.fileCount ?? 0);
        break;
      case "modified":
        cmp = a.modified - b.modified;
        break;
      case "created":
        cmp = (a.created ?? 0) - (b.created ?? 0);
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });

  // Recursively sort children
  return sorted.map((e) =>
    e.children && Array.isArray(e.children)
      ? { ...e, children: sortEntries(e.children, col, dir) }
      : e,
  );
}

export default function FileTree(props: FileTreeProps) {
  const store = useSession();
  const files = useFiles();
  const [selectedPath, setSelectedPath] = createSignal<string>("");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [sortCol, setSortCol] = createSignal<SortColumn>("name");
  const [sortDir, setSortDir] = createSignal<SortDir>("asc");

  const toggleSort = (col: SortColumn) => {
    if (sortCol() === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  // Fetch tree on session change. WebTransport FILE_CHANGES events handle
  // live updates (<50ms). Poll every 30s as fallback for missed events.
  createEffect(() => {
    const sid = store.state.activeSessionId;
    if (!sid) return;
    files.fetchTree(sid);
    const interval = setInterval(() => files.fetchTree(sid), 30000);
    onCleanup(() => clearInterval(interval));
  });

  const tree = () => files.state.tree;

  const handleExpand = (dirPath: string) => {
    const sid = store.state.activeSessionId;
    if (sid) files.fetchSubtree(sid, dirPath);
  };

  const handleSelect = (path: string) => {
    setSelectedPath(path);
    props.onFileSelect(path);
  };

  const filteredTree = () => {
    const q = searchQuery().toLowerCase();
    const base = q ? filterEntries(tree(), q) : tree();
    return sortEntries(base, sortCol(), sortDir());
  };

  const fileCount = () => {
    const t = tree();
    const dirs = t.filter((e) => e.isDir).length;
    const fileN = t.length - dirs;
    return { dirs, files: fileN };
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--ctp-mantle)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "6px 10px",
          "border-bottom": "1px solid var(--ctp-surface0)",
          display: "flex",
          "flex-direction": "column",
          gap: "4px",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
          }}
        >
          <span
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "9px",
              "font-weight": "700",
              "text-transform": "uppercase",
              "letter-spacing": "0.1em",
              color: "var(--ctp-overlay1)",
            }}
          >
            Explorer
          </span>
          <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
            <Show when={tree().length > 0}>
              <span
                style={{
                  "font-family": "var(--font-mono)",
                  "font-size": "9px",
                  color: "var(--ctp-overlay0)",
                }}
              >
                {fileCount().dirs}d {fileCount().files}f
              </span>
            </Show>
            <Show when={store.state.activeSessionId}>
              <button
                onClick={() => {
                  const sid = store.state.activeSessionId;
                  if (sid) files.fetchTree(sid);
                }}
                title="Refresh"
                style={{
                  display: "inline-flex",
                  "align-items": "center",
                  "justify-content": "center",
                  width: "18px",
                  height: "18px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--ctp-overlay0)",
                  padding: "0",
                  "border-radius": "3px",
                  transition: "color 150ms ease, background 150ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--ctp-blue)"; e.currentTarget.style.background = "rgba(137,180,250,0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--ctp-overlay0)"; e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <path d="M8 1L10 3L8 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </Show>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            style={{
              width: "100%",
              padding: "5px 8px 5px 26px",
              background: "var(--ctp-surface0)",
              border: "1px solid var(--ctp-surface1)",
              "border-radius": "6px",
              color: "var(--ctp-text)",
              "font-family": "var(--font-mono)",
              "font-size": "11px",
              outline: "none",
              transition: "border-color 150ms ease, box-shadow 150ms ease",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--ctp-blue)";
              e.currentTarget.style.boxShadow = "0 0 0 2px rgba(137,180,250,0.15)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--ctp-surface1)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
          <svg
            width="12" height="12" viewBox="0 0 16 16"
            style={{
              position: "absolute",
              left: "9px",
              top: "50%",
              transform: "translateY(-50%)",
              "pointer-events": "none",
            }}
          >
            <circle cx="7" cy="7" r="5" fill="none" stroke="var(--ctp-overlay0)" stroke-width="1.5" />
            <line x1="11" y1="11" x2="14" y2="14" stroke="var(--ctp-overlay0)" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
      </div>

      {/* Column Headers */}
      <Show when={tree().length > 0}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            padding: "0 10px 0 8px",
            height: "22px",
            "border-bottom": "1px solid var(--ctp-surface0)",
            "flex-shrink": "0",
          }}
        >
          <ColumnHeader label="Name" column="name" active={sortCol()} dir={sortDir()} onClick={toggleSort} flex />
          <ColumnHeader label="Files" column="files" active={sortCol()} dir={sortDir()} onClick={toggleSort} width="32px" />
          <ColumnHeader label="Size" column="size" active={sortCol()} dir={sortDir()} onClick={toggleSort} width="48px" />
          <ColumnHeader label="Modified" column="modified" active={sortCol()} dir={sortDir()} onClick={toggleSort} width="48px" />
          <ColumnHeader label="Created" column="created" active={sortCol()} dir={sortDir()} onClick={toggleSort} width="48px" />
        </div>
      </Show>

      {/* Tree */}
      <div
        style={{
          flex: "1",
          overflow: "auto",
          padding: "2px 0",
        }}
      >
        <Show when={files.state.treeLoading && tree().length === 0}>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              gap: "8px",
              padding: "24px",
              color: "var(--ctp-overlay0)",
              "font-size": "11px",
              "font-family": "var(--font-mono)",
            }}
          >
            <span style={{
              display: "inline-block",
              width: "14px",
              height: "14px",
              border: "2px solid var(--ctp-surface1)",
              "border-top-color": "var(--ctp-blue)",
              "border-radius": "50%",
              animation: "filetree-spin 600ms linear infinite",
            }} />
            Loading files...
          </div>
        </Show>
        <Show when={files.state.treeError}>
          <div
            style={{
              padding: "12px",
              color: "var(--ctp-red)",
              "font-size": "11px",
              "font-family": "var(--font-mono)",
            }}
          >
            {files.state.treeError}
          </div>
        </Show>
        <For each={filteredTree()}>
          {(entry) => (
            <FileNode
              entry={entry}
              depth={0}
              onSelect={handleSelect}
              onExpand={handleExpand}
              selectedPath={selectedPath()}
            />
          )}
        </For>
        <Show when={!files.state.treeLoading && tree().length === 0 && !files.state.treeError}>
          <div
            style={{
              padding: "24px 12px",
              color: "var(--ctp-overlay0)",
              "font-size": "11px",
              "font-family": "var(--font-mono)",
              "text-align": "center",
            }}
          >
            Select a session to browse files
          </div>
        </Show>
      </div>
    </div>
  );
}

function ColumnHeader(props: {
  label: string;
  column: SortColumn;
  active: SortColumn;
  dir: SortDir;
  onClick: (col: SortColumn) => void;
  width?: string;
  flex?: boolean;
}) {
  const isActive = () => props.active === props.column;
  const arrow = () => {
    if (!isActive()) return "";
    return props.dir === "asc" ? " \u25B4" : " \u25BE";
  };

  return (
    <button
      onClick={() => props.onClick(props.column)}
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": props.flex ? "flex-start" : "flex-end",
        border: "none",
        background: "transparent",
        padding: "0 2px",
        cursor: "pointer",
        "font-family": "var(--font-mono)",
        "font-size": "8px",
        "font-weight": isActive() ? "700" : "500",
        "text-transform": "uppercase",
        "letter-spacing": "0.06em",
        color: isActive() ? "var(--ctp-blue)" : "var(--ctp-overlay0)",
        "white-space": "nowrap",
        "min-width": props.width ?? "auto",
        flex: props.flex ? "1" : "0 0 auto",
        transition: "color 150ms ease",
      }}
    >
      {props.label}{arrow()}
    </button>
  );
}

function filterEntries(entries: FileEntry[], query: string): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDir && Array.isArray(entry.children)) {
      const filteredChildren = filterEntries(entry.children, query);
      if (filteredChildren.length > 0) {
        result.push({ ...entry, children: filteredChildren });
      }
    } else if (entry.name.toLowerCase().includes(query)) {
      result.push(entry);
    }
  }
  return result;
}
