interface ApiRequest {
  id: string;
  method: string;
  url: string;
  statusCode: number;
  latencyMs: number;
  requestSize: number;
  responseSize: number;
  timestamp: number;
}

interface RequestRowProps {
  request: ApiRequest;
  isSelected: boolean;
  onClick: () => void;
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "var(--ctp-green)";
  if (code >= 400 && code < 500) return "var(--ctp-yellow)";
  if (code >= 500) return "var(--ctp-red)";
  return "var(--ctp-overlay1)";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
}

export type { ApiRequest };

export default function RequestRow(props: RequestRowProps) {
  return (
    <button
      onClick={props.onClick}
      style={{
        display: "grid",
        "grid-template-columns": "60px 1fr 50px 60px 60px",
        gap: "8px",
        "align-items": "center",
        width: "100%",
        padding: "6px 12px",
        background: props.isSelected
          ? "var(--ctp-surface0)"
          : "transparent",
        border: "none",
        "border-bottom": "1px solid var(--ctp-surface0)",
        cursor: "pointer",
        "text-align": "left",
        color: "var(--ctp-text)",
        "font-size": "12px",
        "font-family": "var(--font-mono)",
      }}
    >
      <span
        style={{
          "font-weight": "600",
          color: "var(--ctp-blue)",
        }}
      >
        {props.request.method}
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
      <span
        style={{
          "font-weight": "600",
          color: statusColor(props.request.statusCode),
        }}
      >
        {props.request.statusCode}
      </span>
      <span style={{ color: "var(--ctp-overlay1)" }}>
        {formatSize(props.request.responseSize)}
      </span>
      <span style={{ color: "var(--ctp-overlay1)" }}>
        {props.request.latencyMs}ms
      </span>
    </button>
  );
}
