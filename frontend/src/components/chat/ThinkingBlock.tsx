import { Show, createSignal, createEffect } from "solid-js";
import { useExpanded } from "./expandedContext";
import { useItemKey } from "./itemKeyContext";
import MarkdownContent from "./MarkdownContent";

interface ThinkingBlockProps {
  text: string;
  thinkingIndex?: number;
}

export default function ThinkingBlock(props: ThinkingBlockProps) {
  const ctx = useExpanded();
  const itemKey = useItemKey();
  const thinkingKey = () => itemKey ? `${itemKey}-thinking-${props.thinkingIndex ?? 0}` : undefined;
  const expanded = () => {
    const key = thinkingKey();
    return ctx && key ? ctx.isExpanded(key, false) : false;
  };
  const toggleExpanded = () => {
    const key = thinkingKey();
    if (ctx && key) ctx.toggle(key);
  };

  const preview = () => {
    const lines = props.text.split("\n");
    if (lines.length <= 3 && props.text.length <= 200) return props.text;
    return lines.slice(0, 3).join("\n") + "...";
  };

  let contentRef: HTMLDivElement | undefined;
  const [measuredHeight, setMeasuredHeight] = createSignal(80);

  createEffect(() => {
    // Track both text and expanded state to re-measure when content changes
    props.text;
    expanded();
    if (contentRef) {
      // Measure the full scrollHeight of the content
      const h = contentRef.scrollHeight;
      if (h > 0) setMeasuredHeight(h);
    }
  });

  return (
    <div
      style={{
        margin: "6px 0",
        "border-left": "3px solid var(--neon-purple, #a855f7)",
        "border-radius": "0 6px 6px 0",
        background: "rgba(168, 85, 247, 0.06)",
        overflow: "hidden",
        transition: "box-shadow 200ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "inset 0 0 20px rgba(168, 85, 247, 0.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      <button
        onClick={toggleExpanded}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          width: "100%",
          padding: "6px 10px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--ctp-mauve)",
          "font-size": "11px",
          "font-weight": "600",
          "text-align": "left",
        }}
      >
        <span
          style={{
            transform: expanded() ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
            display: "inline-block",
          }}
        >
          {"\u25B6"}
        </span>
        thinking
        <span style={{
          "margin-left": "auto",
          "font-size": "10px",
          "font-weight": "400",
          color: "var(--ctp-overlay0)",
          display: "flex",
          gap: "8px",
          "align-items": "center",
        }}>
          {Math.ceil(props.text.length / 4)} tokens
          <span
            data-testid="thinking-copy-btn"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(props.text);
            }}
            style={{
              cursor: "pointer",
              padding: "1px 6px",
              "border-radius": "3px",
              background: "var(--ctp-surface0)",
              color: "var(--ctp-subtext0)",
              "font-size": "10px",
            }}
          >
            Copy
          </span>
        </span>
      </button>

      <div
        ref={contentRef}
        style={{
          padding: "0 10px 8px",
          "font-family": "var(--font-mono)",
          "font-size": "12px",
          "line-height": "1.5",
          color: "var(--ctp-subtext0)",
          "white-space": "pre-wrap",
          "word-break": "break-word",
          "max-height": expanded() ? `${measuredHeight()}px` : "80px",
          overflow: "hidden",
          transition: "max-height 200ms ease-out",
        }}
      >
        <MarkdownContent text={props.text} />
      </div>
    </div>
  );
}
