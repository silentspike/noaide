import { Show, For, createMemo } from "solid-js";
import type { ChatMessage } from "../../types/messages";
import type { GalleryImage } from "../gallery/GalleryPanel";
import ThinkingBlock from "./ThinkingBlock";
import TokenHeatmap from "./TokenHeatmap";
import MarkdownContent from "./MarkdownContent";
import { useSession } from "../../App";

interface MessageCardProps {
  message: ChatMessage;
  maxTokens: number;
  onImageClick?: (images: GalleryImage[], index: number) => void;
}

interface ParsedApiError {
  status: number;
  errorType: string;
  message: string;
  requestId: string;
}

/** Try to parse an API error from text like "API Error: 500 {...json...}" */
function tryParseApiError(text: string): ParsedApiError | null {
  const match = text.match(/^API Error:\s*(\d{3})\s*(\{.+\})\s*$/s);
  if (!match) return null;
  try {
    const status = parseInt(match[1], 10);
    const json = JSON.parse(match[2]);
    return {
      status,
      errorType: json?.error?.type ?? json?.type ?? "unknown",
      message: json?.error?.message ?? json?.message ?? "Unknown error",
      requestId: json?.request_id ?? "",
    };
  } catch {
    return null;
  }
}

function ApiErrorCard(props: { error: ParsedApiError }) {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        padding: "12px 14px",
        background: "rgba(243, 139, 168, 0.06)",
        border: "1px solid rgba(243, 139, 168, 0.2)",
        "border-left": "3px solid var(--ctp-red, #f38ba8)",
        "border-radius": "4px 8px 8px 4px",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "10px",
        }}
      >
        <span
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "18px",
            "font-weight": "800",
            color: "var(--ctp-red, #f38ba8)",
            "letter-spacing": "-0.02em",
          }}
        >
          {props.error.status}
        </span>
        <div style={{ display: "flex", "flex-direction": "column", gap: "1px" }}>
          <span
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "12px",
              "font-weight": "600",
              color: "var(--ctp-text)",
              "text-transform": "uppercase",
              "letter-spacing": "0.04em",
            }}
          >
            {props.error.errorType.replace(/_/g, " ")}
          </span>
          <span
            style={{
              "font-size": "12px",
              color: "var(--ctp-subtext0)",
            }}
          >
            {props.error.message}
          </span>
        </div>
      </div>
      <Show when={props.error.requestId}>
        <div
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "9px",
            color: "var(--ctp-overlay0)",
            "letter-spacing": "0.02em",
            "padding-top": "4px",
            "border-top": "1px solid rgba(243, 139, 168, 0.08)",
          }}
        >
          {props.error.requestId}
        </div>
      </Show>
    </div>
  );
}

export default function MessageCard(props: MessageCardProps) {
  const isUser = () => props.message.role === "user";
  const timestamp = () => {
    if (!props.message.timestamp) return "";
    const d = new Date(props.message.timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  /** Check if entire message is a single API error */
  const apiError = createMemo(() => {
    const textBlocks = props.message.content.filter(
      (b) => b.type === "text" && b.text,
    );
    if (textBlocks.length !== 1) return null;
    return tryParseApiError(textBlocks[0].text!.trim());
  });

  function copyToClipboard() {
    const text = props.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
    navigator.clipboard.writeText(text);
  }

  return (
    <div
      data-testid={`message-card-${props.message.uuid}`}
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
          "font-size": "10px",
          "font-family": "var(--font-mono)",
          color: "var(--dim, #68687a)",
          padding: "0 4px",
          "letter-spacing": "0.02em",
        }}
      >
        <span style={{
          "font-weight": "700",
          "text-transform": "uppercase",
          color: isUser() ? "var(--neon-blue, #00b8ff)" : "var(--neon-green, #00ff9d)",
        }}>
          {isUser() ? "You" : "Assistant"}
        </span>
        <Show when={props.message.model}>
          <span style={{ color: "var(--dim, #68687a)" }}>
            {props.message.model}
          </span>
        </Show>
        <Show when={timestamp()}>
          <span>{timestamp()}</span>
        </Show>
        {(() => {
          try {
            const store = useSession();
            const uuid = props.message.uuid;
            return (
              <span
                data-testid={`bookmark-toggle-${uuid}`}
                onClick={(e) => { e.stopPropagation(); store.toggleBookmark(uuid); }}
                style={{
                  cursor: "pointer",
                  color: store.isBookmarked(uuid) ? "var(--ctp-yellow)" : "var(--ctp-overlay0)",
                  "font-size": "12px",
                  "margin-left": "4px",
                  transition: "color 150ms",
                }}
              >
                {store.isBookmarked(uuid) ? "\u2605" : "\u2606"}
              </span>
            );
          } catch { return null; }
        })()}
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

        {/* Styled API error card */}
        <Show when={apiError()}>
          {(err) => (
            <div style={{ flex: "1", "min-width": "0" }}>
              <ApiErrorCard error={err()} />
            </div>
          )}
        </Show>

        {/* Normal message bubble */}
        <Show when={!apiError()}>
          <div
            style={{
              background: isUser()
                ? "rgba(0,184,255,0.1)"
                : "rgba(14,14,24,0.75)",
              color: isUser() ? "var(--bright, #f0f0f5)" : "var(--ctp-text)",
              border: isUser()
                ? "1px solid rgba(0,184,255,0.2)"
                : "1px solid var(--ctp-surface1)",
              padding: "10px 14px",
              "border-radius": isUser()
                ? "12px 12px 4px 12px"
                : "12px 12px 12px 4px",
              "font-size": "13px",
              "line-height": "1.6",
              "word-break": "break-word",
              flex: "1",
              "min-width": "0",
              position: "relative",
              "backdrop-filter": "blur(8px)",
              "-webkit-backdrop-filter": "blur(8px)",
            }}
          >
            <For each={props.message.content}>
              {(block, idx) => (
                <>
                  <Show when={block.type === "text" && block.text}>
                    <MarkdownContent text={block.text!} />
                  </Show>
                  <Show when={block.type === "thinking" && block.thinking}>
                    <ThinkingBlock text={block.thinking!} thinkingIndex={idx()} />
                  </Show>
                  <Show when={block.type === "image" && block.source}>
                    <div
                      style={{
                        margin: "4px 0",
                        cursor: "pointer",
                        "border-radius": "8px",
                        overflow: "hidden",
                        "max-width": "400px",
                        border: "1px solid var(--ctp-surface1)",
                        transition: "border-color 200ms ease",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.borderColor =
                          "var(--ctp-mauve)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.borderColor =
                          "var(--ctp-surface1)";
                      }}
                      onClick={() => {
                        if (!props.onImageClick) return;
                        const imgBlocks = props.message.content
                          .filter((b) => b.type === "image" && b.source)
                          .map((b, i) => ({
                            id: `${props.message.uuid}-img-${i}`,
                            src: `data:${b.source!.media_type};base64,${b.source!.data}`,
                            alt: "Image",
                            mediaType: b.source!.media_type,
                          }));
                        const clickedSrc = `data:${block.source!.media_type};base64,${block.source!.data}`;
                        const clickedIdx = imgBlocks.findIndex(
                          (ib) => ib.src === clickedSrc,
                        );
                        props.onImageClick(
                          imgBlocks,
                          clickedIdx >= 0 ? clickedIdx : 0,
                        );
                      }}
                    >
                      <img
                        src={`data:${block.source!.media_type};base64,${block.source!.data}`}
                        alt="Image"
                        style={{
                          "max-width": "100%",
                          "max-height": "300px",
                          "object-fit": "contain",
                          display: "block",
                        }}
                      />
                    </div>
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
                "font-size": "10px",
                "font-family": "var(--font-mono)",
                color: "var(--dim, #68687a)",
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
        </Show>
      </div>
    </div>
  );
}
