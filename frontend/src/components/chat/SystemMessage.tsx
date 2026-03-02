import { Show, For } from "solid-js";
import type { ChatMessage } from "../../types/messages";
import { useExpanded } from "./expandedContext";
import { useItemKey } from "./itemKeyContext";

interface SystemMessageProps {
  message: ChatMessage;
}

export default function SystemMessage(props: SystemMessageProps) {
  const ctx = useExpanded();
  const itemKey = useItemKey();
  const expanded = () => {
    return ctx && itemKey ? ctx.isExpanded(itemKey, true) : true;
  };
  const toggleExpanded = () => {
    if (ctx && itemKey) ctx.toggle(itemKey);
  };

  return (
    <div
      style={{
        margin: "4px 16px",
        "border-radius": "0 6px 6px 0",
        background: "rgba(245, 158, 11, 0.04)",
        border: "1px solid rgba(245, 158, 11, 0.12)",
        "border-left": "3px solid var(--accent-gold, #f59e0b)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={toggleExpanded}
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
