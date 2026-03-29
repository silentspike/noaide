import { createSignal, Show, For, JSX } from "solid-js";
import type { FileEntry } from "../../stores/file";

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  onSelect: (path: string) => void;
  onExpand?: (dirPath: string) => void;
  selectedPath?: string;
}

// ── SVG Icons ───────────────────────────────────────────────────────────────

function ChevronIcon(props: { expanded: boolean }): JSX.Element {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10"
      style={{
        transition: "transform 150ms ease",
        transform: props.expanded ? "rotate(90deg)" : "rotate(0deg)",
        "flex-shrink": "0",
      }}
    >
      <path d="M3.5 2L7 5L3.5 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function FolderIcon(props: { open: boolean; color: string }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ "flex-shrink": "0" }}>
      <Show when={!props.open}>
        {/* Closed folder */}
        <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H6.29289C6.55811 2 6.81246 2.10536 7 2.29289L7.70711 3H13.5C14.0523 3 14.5 3.44772 14.5 4V12C14.5 12.5523 14.0523 13 13.5 13H2.5C1.94772 13 1.5 12.5523 1.5 12V3Z"
          fill={props.color} opacity="0.2" />
        <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H6.29289C6.55811 2 6.81246 2.10536 7 2.29289L7.70711 3H13.5C14.0523 3 14.5 3.44772 14.5 4V12C14.5 12.5523 14.0523 13 13.5 13H2.5C1.94772 13 1.5 12.5523 1.5 12V3Z"
          fill="none" stroke={props.color} stroke-width="1" />
      </Show>
      <Show when={props.open}>
        {/* Open folder */}
        <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H6.29289C6.55811 2 6.81246 2.10536 7 2.29289L7.70711 3H13.5C14.0523 3 14.5 3.44772 14.5 4V5H1.5V3Z"
          fill={props.color} opacity="0.3" />
        <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H6.29289C6.55811 2 6.81246 2.10536 7 2.29289L7.70711 3H13.5C14.0523 3 14.5 3.44772 14.5 4V5H1.5V3Z"
          fill="none" stroke={props.color} stroke-width="1" />
        <path d="M0.5 5.5H14L12.5 13H2L0.5 5.5Z"
          fill={props.color} opacity="0.15" />
        <path d="M0.5 5.5H14L12.5 13H2L0.5 5.5Z"
          fill="none" stroke={props.color} stroke-width="1" />
      </Show>
    </svg>
  );
}

function FileIcon(props: { color: string }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ "flex-shrink": "0" }}>
      <path d="M3 1.5C3 1.22386 3.22386 1 3.5 1H9.5L13 4.5V14.5C13 14.7761 12.7761 15 12.5 15H3.5C3.22386 15 3 14.7761 3 14.5V1.5Z"
        fill="var(--ctp-surface0)" />
      <path d="M9.5 1L13 4.5H10C9.72386 4.5 9.5 4.27614 9.5 4V1Z"
        fill="var(--ctp-surface1)" />
      <path d="M3 1.5C3 1.22386 3.22386 1 3.5 1H9.5L13 4.5V14.5C13 14.7761 12.7761 15 12.5 15H3.5C3.22386 15 3 14.7761 3 14.5V1.5Z"
        fill="none" stroke={props.color} stroke-width="0.8" opacity="0.6" />
      {/* Color accent bar at bottom */}
      <rect x="4.5" y="11" width="7" height="2.5" rx="0.5" fill={props.color} opacity="0.45" />
    </svg>
  );
}

// ── Extension → type info ───────────────────────────────────────────────────

interface FileTypeInfo {
  badge: string;
  color: string;
}

const EXT_MAP: Record<string, FileTypeInfo> = {
  // Rust
  rs:   { badge: "RS",  color: "#fab387" },  // peach
  // TypeScript / JavaScript
  ts:   { badge: "TS",  color: "#89b4fa" },  // blue
  tsx:  { badge: "TX",  color: "#89b4fa" },
  js:   { badge: "JS",  color: "#f9e2af" },  // yellow
  jsx:  { badge: "JX",  color: "#f9e2af" },
  mjs:  { badge: "MJ",  color: "#f9e2af" },
  // Python
  py:   { badge: "PY",  color: "#a6e3a1" },  // green
  // Go
  go:   { badge: "GO",  color: "#94e2d5" },  // teal
  // Markup / Docs
  md:   { badge: "MD",  color: "#cdd6f4" },  // text
  html: { badge: "HT",  color: "#f38ba8" },  // red
  htm:  { badge: "HT",  color: "#f38ba8" },
  // Styles
  css:  { badge: "CS",  color: "#cba6f7" },  // mauve
  scss: { badge: "SC",  color: "#f5c2e7" },  // pink
  // Config
  json: { badge: "{}",  color: "#f9e2af" },
  toml: { badge: "TM",  color: "#fab387" },
  yaml: { badge: "YM",  color: "#f2cdcd" },  // flamingo
  yml:  { badge: "YM",  color: "#f2cdcd" },
  // Shell
  sh:   { badge: "SH",  color: "#a6e3a1" },
  bash: { badge: "SH",  color: "#a6e3a1" },
  // Lock / Generated
  lock: { badge: "LK",  color: "#585b70" },  // surface2
  // SQL
  sql:  { badge: "SQ",  color: "#89dceb" },  // sky
  // Misc
  txt:  { badge: "TX",  color: "#7f849c" },
  log:  { badge: "LG",  color: "#6c7086" },
  woff2:{ badge: "FT",  color: "#6c7086" },
  wasm: { badge: "WA",  color: "#94e2d5" },
  png:  { badge: "IM",  color: "#f5c2e7" },
  jpg:  { badge: "IM",  color: "#f5c2e7" },
  svg:  { badge: "SV",  color: "#f5c2e7" },
  fbs:  { badge: "FB",  color: "#89dceb" },
};

function getFileInfo(name: string): FileTypeInfo {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return { badge: "DK", color: "#89b4fa" };
  if (lower.startsWith(".git")) return { badge: "GI", color: "#585b70" };
  if (lower === "license" || lower === "licence") return { badge: "LI", color: "#f9e2af" };
  if (lower === "makefile") return { badge: "MK", color: "#fab387" };

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? { badge: ext.slice(0, 2).toUpperCase() || "..", color: "#7f849c" };
}

// ── Folder color by name ────────────────────────────────────────────────────

function getFolderColor(name: string): string {
  const map: Record<string, string> = {
    src: "#89b4fa", lib: "#89b4fa", frontend: "#89b4fa",
    components: "#cba6f7", layouts: "#cba6f7", mobile: "#cba6f7",
    hooks: "#f5c2e7", styles: "#f5c2e7", gallery: "#f5c2e7",
    stores: "#a6e3a1", tests: "#a6e3a1", test: "#a6e3a1", ecs: "#a6e3a1", chat: "#a6e3a1",
    server: "#fab387", scripts: "#fab387", crates: "#fab387", tools: "#fab387", watcher: "#fab387",
    wasm: "#94e2d5", transport: "#94e2d5", bus: "#94e2d5", discovery: "#94e2d5", workers: "#94e2d5",
    schemas: "#f2cdcd", network: "#89dceb", teams: "#89b4fa",
    parser: "#f9e2af", files: "#f9e2af", assets: "#f9e2af", public: "#f9e2af",
    db: "#eba0ac", certs: "#eba0ac", git: "#f38ba8", profiler: "#f38ba8",
    session: "#f5c2e7", editor: "#89b4fa", tasks: "#a6e3a1",
    ".github": "#7f849c", ".git": "#585b70", shared: "#7f849c", settings: "#7f849c",
    dist: "#585b70", build: "#585b70", target: "#585b70", node_modules: "#585b70",
  };
  return map[name.toLowerCase()] ?? "#f9e2af";
}

// ── Formatters ──────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function formatDate(epochSecs: number): string {
  if (!epochSecs) return "";
  const d = new Date(epochSecs * 1000);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays === 0) {
    // Today: show time
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays < 7) {
    return `${diffDays}d`;
  } else if (diffDays < 365) {
    const mon = d.toLocaleString("de-DE", { month: "short" });
    return `${d.getDate()} ${mon}`;
  }
  return d.toLocaleDateString("de-DE", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

const META_STYLE = {
  "font-size": "9px",
  "font-family": "var(--font-mono)",
  color: "var(--ctp-overlay0)",
  "flex-shrink": "0",
  "text-align": "right" as const,
  "white-space": "nowrap" as const,
};

// ── Component ───────────────────────────────────────────────────────────────

export default function FileNode(props: FileNodeProps) {
  const [expanded, setExpanded] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  const isSelected = () => props.selectedPath === props.entry.path;

  const handleClick = () => {
    if (props.entry.isDir) {
      const willExpand = !expanded();
      setExpanded(willExpand);
      if (willExpand && props.entry.children === null && props.onExpand) {
        props.onExpand(props.entry.path);
      }
    } else {
      props.onSelect(props.entry.path);
    }
  };

  const folderColor = () => getFolderColor(props.entry.name);
  const fileInfo = () => getFileInfo(props.entry.name);

  // Animation based on entry state — full row highlight with border flash
  const animationStyle = (): string | undefined => {
    if (props.entry.recentlyCreated) return "filetree-created 800ms ease-out forwards";
    if (props.entry.recentlyModified) return "filetree-modified 1200ms ease-out forwards";
    return undefined;
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Indent guides */}
      <For each={Array.from({ length: props.depth })}>
        {(_, i) => (
          <div
            style={{
              position: "absolute",
              left: `${15 + i() * 18}px`,
              top: "0",
              bottom: "0",
              width: "1px",
              background: isSelected() ? "rgba(137,180,250,0.15)" : "var(--ctp-surface0)",
              opacity: "0.6",
              "pointer-events": "none",
            }}
          />
        )}
      </For>

      <button
        data-file-path={props.entry.path}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "5px",
          width: "100%",
          height: "26px",
          padding: `0 10px 0 ${8 + props.depth * 18}px`,
          background: isSelected()
            ? "rgba(137,180,250,0.10)"
            : hovered()
              ? "rgba(205,214,244,0.04)"
              : "transparent",
          border: "none",
          "border-left": isSelected()
            ? "2px solid var(--ctp-blue)"
            : "2px solid transparent",
          cursor: "pointer",
          color: isSelected()
            ? "var(--ctp-text)"
            : props.entry.isDir
              ? "var(--ctp-subtext1)"
              : "var(--ctp-subtext0)",
          "font-family": "var(--font-mono)",
          "font-size": "12px",
          "font-weight": props.entry.isDir ? "500" : "400",
          "text-align": "left",
          transition: "background 100ms ease, border-color 100ms ease",
          position: "relative",
          animation: animationStyle(),
        }}
      >
        {/* Directory row */}
        <Show when={props.entry.isDir}>
          <span style={{ color: folderColor(), display: "inline-flex", "align-items": "center" }}>
            <ChevronIcon expanded={expanded()} />
          </span>
          <FolderIcon open={expanded()} color={folderColor()} />
          <span
            style={{
              flex: "1",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
              color: folderColor(),
            }}
          >
            {props.entry.name}
          </span>
          {/* Dir stats — columns aligned with header: Files | Size | Modified | Created */}
          <span style={{ ...META_STYLE, "min-width": "32px" }}>
            {props.entry.fileCount != null ? `${props.entry.fileCount}` : ""}
          </span>
          <span style={{ ...META_STYLE, "min-width": "48px" }}>
            {props.entry.totalSize != null && props.entry.totalSize > 0 ? formatSize(props.entry.totalSize) : ""}
          </span>
          <span style={{ ...META_STYLE, "min-width": "48px" }} title={props.entry.modified ? new Date(props.entry.modified * 1000).toLocaleString("de-DE") : ""}>
            {formatDate(props.entry.modified)}
          </span>
          <span style={{ ...META_STYLE, "min-width": "48px" }} title={props.entry.created ? new Date(props.entry.created * 1000).toLocaleString("de-DE") : ""}>
            {props.entry.created ? formatDate(props.entry.created) : ""}
          </span>
        </Show>

        {/* File row */}
        <Show when={!props.entry.isDir}>
          <span style={{ width: "10px", "flex-shrink": "0" }} />
          <FileIcon color={fileInfo().color} />
          <span
            style={{
              flex: "1",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
              color: isSelected() ? "var(--ctp-text)" : "var(--ctp-subtext0)",
            }}
          >
            {props.entry.name}
          </span>
          <span
            style={{
              "font-size": "7.5px",
              "font-weight": "700",
              color: fileInfo().color,
              opacity: "0.5",
              "flex-shrink": "0",
              "letter-spacing": "0.03em",
              "margin-right": "2px",
            }}
          >
            {fileInfo().badge}
          </span>
          {/* File metadata — columns aligned with header: Files | Size | Modified | Created */}
          <span style={{ ...META_STYLE, "min-width": "32px" }}>
            {/* empty — files column only for dirs */}
          </span>
          <span style={{ ...META_STYLE, "min-width": "48px" }}>
            {formatSize(props.entry.size)}
          </span>
          <span style={{ ...META_STYLE, "min-width": "48px" }} title={props.entry.modified ? new Date(props.entry.modified * 1000).toLocaleString("de-DE") : ""}>
            {formatDate(props.entry.modified)}
          </span>
          <span style={{ ...META_STYLE, "min-width": "48px" }} title={props.entry.created ? new Date(props.entry.created * 1000).toLocaleString("de-DE") : ""}>
            {props.entry.created ? formatDate(props.entry.created) : ""}
          </span>
        </Show>

        {/* Recently modified indicator */}
        <Show when={props.entry.recentlyModified}>
          <span
            style={{
              width: "7px",
              height: "7px",
              "border-radius": "50%",
              background: "var(--ctp-peach)",
              "flex-shrink": "0",
              "box-shadow": "0 0 6px rgba(250,179,135,0.4)",
            }}
          />
        </Show>
      </button>

      {/* Loading indicator */}
      <Show when={props.entry.isDir && expanded() && props.entry.children === null}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            height: "24px",
            padding: `0 10px 0 ${8 + (props.depth + 1) * 18 + 10 + 5}px`,
            color: "var(--ctp-overlay0)",
            "font-size": "10px",
            "font-family": "var(--font-mono)",
            "font-style": "italic",
          }}
        >
          <span style={{
            display: "inline-block",
            width: "10px",
            height: "10px",
            border: "1.5px solid var(--ctp-surface1)",
            "border-top-color": "var(--ctp-blue)",
            "border-radius": "50%",
            animation: "filetree-spin 600ms linear infinite",
          }} />
          loading...
        </div>
      </Show>

      {/* Children */}
      <Show when={props.entry.isDir && expanded() && Array.isArray(props.entry.children)}>
        <For each={props.entry.children!}>
          {(child) => (
            <FileNode
              entry={child}
              depth={props.depth + 1}
              onSelect={props.onSelect}
              onExpand={props.onExpand}
              selectedPath={props.selectedPath}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
