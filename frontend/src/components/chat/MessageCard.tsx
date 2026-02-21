import { Show, For } from "solid-js";
import type { ChatMessage } from "../../types/messages";
import ThinkingBlock from "./ThinkingBlock";
import TokenHeatmap from "./TokenHeatmap";

interface MessageCardProps {
  message: ChatMessage;
  maxTokens: number;
}

export default function MessageCard(props: MessageCardProps) {
  const isUser = () => props.message.role === "user";
  const timestamp = () => {
    if (!props.message.timestamp) return "";
    const d = new Date(props.message.timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  function copyToClipboard() {
    const text = props.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
    navigator.clipboard.writeText(text);
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": isUser() ? "flex-end" : "flex-start",
        padding: "4px 16px",
        gap: "2px",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "font-size": "11px",
          color: "var(--ctp-overlay1)",
          padding: "0 4px",
        }}
      >
        <span style={{ "font-weight": "600" }}>
          {isUser() ? "You" : "Assistant"}
        </span>
        <Show when={props.message.model}>
          <span style={{ color: "var(--ctp-overlay0)" }}>
            {props.message.model}
          </span>
        </Show>
        <Show when={timestamp()}>
          <span>{timestamp()}</span>
        </Show>
      </div>

      <div
        style={{
          display: "flex",
          gap: "4px",
          "max-width": "85%",
          width: "100%",
        }}
      >
        <TokenHeatmap message={props.message} maxTokens={props.maxTokens} />
        <div
          style={{
            background: isUser()
              ? "var(--ctp-blue)"
              : "var(--ctp-surface0)",
            color: isUser() ? "var(--ctp-crust)" : "var(--ctp-text)",
            padding: "10px 14px",
            "border-radius": isUser()
              ? "14px 14px 4px 14px"
              : "14px 14px 14px 4px",
            "font-size": "13px",
            "line-height": "1.5",
            "word-break": "break-word",
            "white-space": "pre-wrap",
            flex: "1",
            "min-width": "0",
            position: "relative",
          }}
        >
          <For each={props.message.content}>
            {(block) => (
              <>
                <Show when={block.type === "text" && block.text}>
                  <div>{block.text}</div>
                </Show>
                <Show when={block.type === "thinking" && block.thinking}>
                  <ThinkingBlock text={block.thinking!} />
                </Show>
              </>
            )}
          </For>

          <div
            style={{
              display: "flex",
              "justify-content": "flex-end",
              "margin-top": "6px",
              gap: "8px",
              "font-size": "11px",
              color: isUser()
                ? "var(--ctp-surface1)"
                : "var(--ctp-overlay0)",
            }}
          >
            <Show when={props.message.durationMs}>
              <span>{(props.message.durationMs! / 1000).toFixed(1)}s</span>
            </Show>
            <Show when={props.message.costUsd}>
              <span>${props.message.costUsd!.toFixed(4)}</span>
            </Show>
            <button
              onClick={copyToClipboard}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                padding: "0",
                "font-size": "11px",
              }}
              title="Copy to clipboard"
            >
              Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
