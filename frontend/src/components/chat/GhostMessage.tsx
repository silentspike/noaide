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
        background: "rgba(14,14,24,0.4)",
        border: "1px solid rgba(37,37,53,0.3)",
        "border-radius": "6px",
        opacity: "0.4",
        "font-size": "12px",
        color: "var(--dim, #68687a)",
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
          "font-size": "9px",
          "font-family": "var(--font-mono)",
          color: "var(--dim, #68687a)",
          "font-weight": "700",
          "text-transform": "uppercase",
          "letter-spacing": "0.1em",
          "font-style": "normal",
        }}
      >
        compressed
      </div>
      {preview()}
    </div>
  );
}
