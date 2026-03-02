import { Show } from "solid-js";
import type { ChatMessage } from "../../types/messages";
import { useExpanded } from "./expandedContext";
import { useItemKey } from "./itemKeyContext";

interface MetaMessageProps {
  message: ChatMessage;
}

/** Visual styles per meta message type */
const META_STYLES: Record<string, {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: string;
}> = {
  progress: {
    label: "PROGRESS",
    color: "var(--ctp-blue)",
    bg: "rgba(137, 180, 250, 0.04)",
    border: "rgba(137, 180, 250, 0.15)",
    icon: "\u25CB", // circle
  },
  summary: {
    label: "SUMMARY",
    color: "var(--ctp-mauve)",
    bg: "rgba(203, 166, 247, 0.04)",
    border: "rgba(203, 166, 247, 0.15)",
    icon: "\u2261", // triple bar
  },
  filesnapshot: {
    label: "FILE SNAPSHOT",
    color: "var(--ctp-teal)",
    bg: "rgba(148, 226, 213, 0.04)",
    border: "rgba(148, 226, 213, 0.15)",
    icon: "\u2630", // trigram
  },
};

const DEFAULT_STYLE = {
  label: "META",
  color: "var(--ctp-overlay1)",
  bg: "rgba(108, 112, 134, 0.04)",
  border: "rgba(108, 112, 134, 0.15)",
  icon: "\u2022", // bullet
};

/** Render a single meta entry (progress, summary, file-history-snapshot, unknown). */
export default function MetaMessage(props: MetaMessageProps) {
  const ctx = useExpanded();
  const itemKey = useItemKey();

  // Default collapsed for meta messages
  const expanded = () => {
    return ctx && itemKey ? ctx.isExpanded(itemKey, false) : false;
  };
  const toggleExpanded = () => {
    if (ctx && itemKey) ctx.toggle(itemKey);
  };

  const style = () => {
    const t = props.message.messageType.toLowerCase();
    return META_STYLES[t] ?? DEFAULT_STYLE;
  };

  /** Extract a one-line summary for the collapsed view */
  const summary = () => {
    const t = props.message.messageType.toLowerCase();
    const text = props.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    if (t === "progress") {
      // Try to extract hook/tool progress type from JSON data
      try {
        const data = JSON.parse(text);
        if (data.type === "hook_progress") {
          const status = data.status ?? "";
          const hook = data.hookEvent ?? "";
          return `${hook} ${status}`.trim();
        }
        if (data.content) {
          return String(data.content).substring(0, 120);
        }
        return data.type ?? "progress event";
      } catch {
        return text.substring(0, 120) || "progress event";
      }
    }

    if (t === "summary") {
      return text.substring(0, 150) || "conversation summary";
    }

    if (t === "filesnapshot") {
      try {
        const snap = JSON.parse(text);
        // Count files in trackedFileBackups (not root keys)
        const backups = snap.trackedFileBackups ?? snap;
        const count = typeof backups === "object" ? Object.keys(backups).length : 0;
        return `${count} file(s) tracked`;
      } catch {
        return text.substring(0, 120) || "file snapshot";
      }
    }

    return text.substring(0, 120) || props.message.messageType;
  };

  const fullContent = () => {
    return props.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  };

  /** Pretty-print JSON content if possible */
  const formattedContent = () => {
    const raw = fullContent();
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  };

  const time = () => {
    if (!props.message.timestamp) return "";
    const d = new Date(props.message.timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div
      style={{
        margin: "2px 16px",
        "border-radius": "0 4px 4px 0",
        background: style().bg,
        border: `1px solid ${style().border}`,
        "border-left": `3px solid ${style().color}`,
        "font-family": "var(--font-mono)",
        "font-size": "11px",
        overflow: "hidden",
      }}
    >
      <button
        onClick={toggleExpanded}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          width: "100%",
          padding: "4px 10px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: style().color,
          "font-size": "10px",
          "font-weight": "600",
          "letter-spacing": "0.06em",
          "text-align": "left",
          "font-family": "var(--font-mono)",
        }}
      >
        <span
          style={{
            transform: expanded() ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 120ms ease",
            display: "inline-block",
            "font-size": "8px",
          }}
        >
          {"\u25B6"}
        </span>
        <span>{style().icon}</span>
        <span>{style().label}</span>
        <span
          style={{
            color: "var(--ctp-overlay0)",
            "font-weight": "400",
            flex: "1",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {summary()}
        </span>
        <Show when={time()}>
          <span style={{ color: "var(--ctp-overlay0)", "font-weight": "400", "flex-shrink": "0" }}>
            {time()}
          </span>
        </Show>
      </button>

      <Show when={expanded()}>
        <div
          style={{
            padding: "6px 10px 8px",
            "font-size": "11px",
            "line-height": "1.5",
            color: "var(--ctp-subtext0)",
            "white-space": "pre-wrap",
            "word-break": "break-word",
            "max-height": "300px",
            overflow: "auto",
            "border-top": `1px solid ${style().border}`,
          }}
        >
          {formattedContent()}
        </div>
      </Show>
    </div>
  );
}
