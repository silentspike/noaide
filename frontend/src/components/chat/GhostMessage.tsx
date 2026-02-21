import type { ChatMessage } from "../../types/messages";

interface GhostMessageProps {
  message: ChatMessage;
}

export default function GhostMessage(props: GhostMessageProps) {
  const text = () =>
    props.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");

  const preview = () => {
    const t = text();
    return t.length > 120 ? t.slice(0, 120) + "..." : t;
  };

  return (
    <div
      style={{
        margin: "4px 16px",
        padding: "8px 12px",
        background: "var(--ctp-surface0)",
        "border-radius": "8px",
        opacity: "0.3",
        "font-size": "12px",
        color: "var(--ctp-subtext0)",
        "font-style": "italic",
        "line-height": "1.4",
        cursor: "default",
      }}
      title="This message was compressed during context management"
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          "margin-bottom": "4px",
          "font-size": "10px",
          color: "var(--ctp-overlay0)",
          "font-weight": "600",
          "text-transform": "uppercase",
          "letter-spacing": "0.05em",
          "font-style": "normal",
        }}
      >
        compressed
      </div>
      {preview()}
    </div>
  );
}
