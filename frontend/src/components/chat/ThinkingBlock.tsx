import { createSignal, Show } from "solid-js";

interface ThinkingBlockProps {
  text: string;
}

export default function ThinkingBlock(props: ThinkingBlockProps) {
  const [expanded, setExpanded] = createSignal(false);

  const preview = () => {
    const lines = props.text.split("\n");
    if (lines.length <= 3 && props.text.length <= 200) return props.text;
    return lines.slice(0, 3).join("\n") + "...";
  };

  return (
    <div
      style={{
        margin: "6px 0",
        "border-left": "3px solid var(--ctp-mauve)",
        "border-radius": "0 6px 6px 0",
        background: "rgba(203, 166, 247, 0.08)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded())}
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
      </button>

      <div
        style={{
          padding: "0 10px 8px",
          "font-family": "var(--font-mono)",
          "font-size": "12px",
          "line-height": "1.5",
          color: "var(--ctp-subtext0)",
          "white-space": "pre-wrap",
          "word-break": "break-word",
          "max-height": expanded() ? "none" : "80px",
          overflow: "hidden",
          transition: "max-height 200ms ease",
        }}
      >
        <Show when={expanded()} fallback={<span>{preview()}</span>}>
          {props.text}
        </Show>
      </div>
    </div>
  );
}
