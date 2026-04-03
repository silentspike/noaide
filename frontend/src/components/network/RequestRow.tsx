import { createSignal, Show, onCleanup } from "solid-js";

interface ApiRequest {
  id: string;
  method: string;
  url: string;
  statusCode: number;
  latencyMs: number;
  requestSize: number;
  responseSize: number;
  timestamp: number;
  requestPreview?: string;
  responsePreview?: string;
  category?: string;
}

interface RequestRowProps {
  request: ApiRequest;
  isSelected: boolean;
  onClick: () => void;
  /** Earliest timestamp in the current request set (ms) */
  timelineStart: number;
  /** Total timeline duration (ms) */
  timelineDuration: number;
  /** Called when user selects "Block this domain" from context menu */
  onQuickBlock?: (domain: string) => void;
  /** Called when user selects "Block all [category]" from context menu */
  onBlockCategory?: (category: string) => void;
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "#a6e3a1"; // ctp-green
  if (code >= 300 && code < 400) return "#89b4fa"; // ctp-blue (redirects)
  if (code >= 400 && code < 500) return "#f9e2af"; // ctp-yellow
  if (code >= 500) return "#f38ba8"; // ctp-red
  return "#a6adc8"; // ctp-overlay1
}

function statusColorDark(code: number): string {
  if (code >= 200 && code < 300) return "#40a02b";
  if (code >= 300 && code < 400) return "#1e66f5";
  if (code >= 400 && code < 500) return "#df8e1d";
  if (code >= 500) return "#d20f39";
  return "#6c7086";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** Map traffic category to Catppuccin Mocha color */
function categoryColor(category?: string): string {
  switch (category) {
    case "Api": return "#89b4fa"; // ctp-blue
    case "Telemetry": return "#f9e2af"; // ctp-yellow
    case "Auth": return "#cba6f7"; // ctp-mauve
    case "Update": return "#fab387"; // ctp-peach
    case "Git": return "#a6e3a1"; // ctp-green
    default: return "#6c7086"; // ctp-overlay0
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    // CONNECT tunnel URLs like tunnel://host:port have no useful pathname
    if (u.protocol === "tunnel:") return u.host;
    return u.pathname;
  } catch {
    return url;
  }
}

export type { ApiRequest };
export { statusColor, statusColorDark, formatSize, formatTime, shortUrl, categoryColor };

export default function RequestRow(props: RequestRowProps) {
  const [hovered, setHovered] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number } | null>(null);

  function getDomain(): string {
    try {
      return new URL(props.request.url).hostname;
    } catch {
      return props.request.url;
    }
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });

    const dismiss = () => {
      setContextMenu(null);
      document.removeEventListener("click", dismiss);
    };
    document.addEventListener("click", dismiss);
    onCleanup(() => document.removeEventListener("click", dismiss));
  }

  const barOffset = () => {
    if (props.timelineDuration <= 0) return 0;
    return (
      ((props.request.timestamp - props.timelineStart) /
        props.timelineDuration) *
      100
    );
  };

  const barWidth = () => {
    if (props.timelineDuration <= 0) return 100;
    const pct = (props.request.latencyMs / props.timelineDuration) * 100;
    return Math.max(pct, 4); // minimum 4% for visibility
  };

  const color = () => statusColor(props.request.statusCode);
  const colorDark = () => statusColorDark(props.request.statusCode);

  const hasPreview = () =>
    props.request.requestPreview || props.request.responsePreview;

  return (
    <button
      data-testid={`request-row-${props.request.id}`}
      onClick={() => props.onClick()}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        "flex-direction": "column",
        width: "100%",
        padding: "0",
        background: props.isSelected
          ? "var(--ctp-surface0)"
          : hovered()
            ? "var(--ctp-surface0)80"
            : "transparent",
        border: "none",
        "border-bottom": "1px solid var(--ctp-surface0)",
        cursor: "pointer",
        "text-align": "left",
        color: "var(--ctp-text)",
        "font-family": "var(--font-mono)",
        transition: "background 150ms ease",
      }}
    >
      {/* Primary row: category dot, method, url, status, size, time, waterfall */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "12px 60px 58px 1fr 50px 60px 60px 160px",
          gap: "8px",
          "align-items": "center",
          padding: "6px 12px 2px 12px",
          "font-size": "12px",
        }}
      >
        {/* Category dot */}
        <span
          title={props.request.category || "Unknown"}
          style={{
            width: "8px",
            height: "8px",
            "border-radius": "50%",
            background: categoryColor(props.request.category),
            "flex-shrink": "0",
          }}
        />
        <span style={{ "font-weight": "600", color: "var(--ctp-blue)" }}>
          {props.request.method}
        </span>
        <span
          style={{
            "font-size": "10px",
            color: "var(--ctp-overlay1)",
            "font-variant-numeric": "tabular-nums",
          }}
        >
          {formatTime(props.request.timestamp)}
        </span>
        <span
          style={{
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            color: "var(--ctp-subtext0)",
          }}
          title={props.request.url}
        >
          {shortUrl(props.request.url)}
        </span>
        <span style={{ "font-weight": "600", color: color() }}>
          {props.request.statusCode}
        </span>
        <span style={{ color: "var(--ctp-overlay1)" }}>
          {formatSize(props.request.responseSize)}
        </span>
        <span style={{ color: "var(--ctp-overlay1)" }}>
          {props.request.latencyMs}ms
        </span>
        {/* Waterfall bar */}
        <div
          style={{
            position: "relative",
            height: "16px",
            background: "var(--ctp-mantle)",
            "border-radius": "2px",
            overflow: "hidden",
          }}
          title={`${props.request.latencyMs}ms — offset ${Math.round(props.request.timestamp - props.timelineStart)}ms`}
        >
          <div
            style={{
              position: "absolute",
              left: "0",
              width: `${barOffset()}%`,
              top: "7px",
              height: "2px",
              background: `${color()}30`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${barOffset()}%`,
              width: `${barWidth()}%`,
              top: "2px",
              height: "12px",
              background: `linear-gradient(180deg, ${color()}, ${colorDark()})`,
              "border-radius": "2px",
              "box-shadow": `0 1px 3px ${color()}50, inset 0 1px 0 ${color()}40`,
              transition: "opacity 150ms ease",
              opacity: hovered() ? "1" : "0.85",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `calc(${barOffset() + barWidth()}% + 4px)`,
              top: "1px",
              "font-size": "9px",
              "font-weight": "500",
              color: color(),
              "white-space": "nowrap",
              opacity: hovered() ? "1" : "0",
              transition: "opacity 150ms ease",
            }}
          >
            {props.request.latencyMs}ms
          </div>
        </div>
      </div>

      {/* Preview row: shows request/response content summary */}
      <Show when={hasPreview()}>
        <div
          style={{
            display: "grid",
            "grid-template-columns": "60px 58px 1fr 1fr",
            gap: "8px",
            padding: "0 12px 5px 12px",
            "font-size": "10px",
            "line-height": "1.4",
          }}
        >
          {/* Spacers to align with method + time columns */}
          <span />
          <span />
          {/* Request preview */}
          <Show when={props.request.requestPreview}>
            <span
              style={{
                color: "var(--ctp-overlay0)",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
              title={props.request.requestPreview}
            >
              <span
                style={{
                  color: "var(--ctp-mauve)",
                  "font-weight": "500",
                  "margin-right": "4px",
                }}
              >
                REQ
              </span>
              {props.request.requestPreview}
            </span>
          </Show>
          <Show when={!props.request.requestPreview}>
            <span />
          </Show>
          {/* Response preview */}
          <Show when={props.request.responsePreview}>
            <span
              style={{
                color: "var(--ctp-overlay0)",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
              title={props.request.responsePreview}
            >
              <span
                style={{
                  color: color(),
                  "font-weight": "500",
                  "margin-right": "4px",
                }}
              >
                RES
              </span>
              {props.request.responsePreview}
            </span>
          </Show>
        </div>
      </Show>

      {/* Context Menu */}
      <Show when={contextMenu()}>
        <div
          data-testid="request-context-menu"
          style={{
            position: "fixed",
            left: `${contextMenu()!.x}px`,
            top: `${contextMenu()!.y}px`,
            "z-index": "1000",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "6px",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
            padding: "4px 0",
            "min-width": "180px",
          }}
        >
          <Show when={props.onQuickBlock}>
            <button
              data-testid="ctx-block-domain"
              onClick={() => {
                props.onQuickBlock?.(getDomain());
                setContextMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                "font-size": "11px",
                background: "transparent",
                border: "none",
                color: "var(--ctp-red)",
                cursor: "pointer",
                "text-align": "left",
              }}
            >
              Block {getDomain()}
            </button>
          </Show>
          <Show when={props.onBlockCategory && props.request.category}>
            <button
              data-testid="ctx-block-category"
              onClick={() => {
                props.onBlockCategory?.(props.request.category!);
                setContextMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                "font-size": "11px",
                background: "transparent",
                border: "none",
                color: "var(--ctp-yellow)",
                cursor: "pointer",
                "text-align": "left",
              }}
            >
              Block all {props.request.category}
            </button>
          </Show>
        </div>
      </Show>
    </button>
  );
}
