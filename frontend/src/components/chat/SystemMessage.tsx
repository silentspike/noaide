import { createSignal, Show, For } from "solid-js";
import type { ChatMessage } from "../../types/messages";

interface SystemMessageProps {
  message: ChatMessage;
}

export default function SystemMessage(props: SystemMessageProps) {
  const [expanded, setExpanded] = createSignal(true);

  return (
    <div
      style={{
        margin: "4px 16px",
        "border-left": "3px solid var(--ctp-yellow)",
        "border-radius": "0 8px 8px 0",
        background: "var(--ctp-surface0)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded())}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          width: "100%",
          padding: "8px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--ctp-yellow)",
          "font-size": "11px",
          "font-weight": "600",
          "text-transform": "uppercase",
          "letter-spacing": "0.05em",
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
        system-reminder
        <Show when={props.message.messageType !== "system"}>
          <span style={{ color: "var(--ctp-overlay0)", "font-weight": "400" }}>
            ({props.message.messageType})
          </span>
        </Show>
      </button>

      <Show when={expanded()}>
        <div
          style={{
            padding: "8px 12px 12px",
            "font-family": "var(--font-mono)",
            "font-size": "12px",
            "line-height": "1.6",
            color: "var(--ctp-subtext0)",
            "white-space": "pre-wrap",
            "word-break": "break-word",
            "max-height": "400px",
            overflow: "auto",
          }}
        >
          <For each={props.message.content}>
            {(block) => (
              <Show when={block.type === "text" && block.text}>
                <div>{block.text}</div>
              </Show>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
