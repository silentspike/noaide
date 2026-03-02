import { Show, createMemo, createSignal, createEffect } from "solid-js";
import { useSession } from "../../App";
import type { ChatMessage, ContentBlock, ImageSource } from "../../types/messages";
import { totalTokens } from "../../types/messages";
import type { GalleryImage } from "../gallery/GalleryPanel";
import VirtualScroller from "./VirtualScroller";
import MessageCard from "./MessageCard";
import SystemMessage from "./SystemMessage";
import GhostMessage from "./GhostMessage";
import ToolCard from "./ToolCard";
import BreathingOrb from "./BreathingOrb";
import ContextMeter from "./ContextMeter";
import ModelBadge from "./ModelBadge";
import InputField from "./InputField";
import MetaMessage from "./MetaMessage";
import LoadingProgress from "./LoadingProgress";
import Lightbox from "../gallery/Lightbox";
import { ExpandedProvider, type ExpandedState } from "./expandedContext";
import { ItemKeyProvider } from "./itemKeyContext";

/** Collect consecutive tool_use + tool_result blocks into a single ToolCard entry */
interface RenderItem {
  type: "message" | "system" | "ghost" | "tool" | "meta";
  message?: ChatMessage;
  toolBlocks?: ContentBlock[];
  key: string;
}

function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];

  // Index: tool_use_id → tool_use ContentBlock (for cross-message matching)
  const toolUseById = new Map<string, ContentBlock>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.id) {
        toolUseById.set(block.id, block);
      }
    }
  }

  // Track which tool_use blocks were consumed by a cross-message tool_result
  const consumedToolUseIds = new Set<string>();

  // First pass: find tool_result-only messages and mark their tool_use as consumed
  for (const msg of messages) {
    const hasToolResult = msg.content.some((b) => b.type === "tool_result");
    const hasToolUse = msg.content.some((b) => b.type === "tool_use");
    if (hasToolResult && !hasToolUse) {
      for (const block of msg.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          consumedToolUseIds.add(block.tool_use_id);
        }
      }
    }
  }

  for (const msg of messages) {
    if (msg.isGhost) {
      items.push({ type: "ghost", message: msg, key: msg.uuid });
      continue;
    }

    // Meta entries: progress, summary, file-history-snapshot, unknown non-conversation
    // Skip empty meta messages (e.g. messageType "text" with no content)
    // Collapse consecutive meta entries of the same messageType (e.g. bash_progress
    // heartbeats) into a single entry — show only the latest one.
    if (msg.role === "meta") {
      const metaText = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (!metaText.trim()) continue;
      const prev = items[items.length - 1];
      if (prev?.type === "meta" && prev.message?.messageType === msg.messageType) {
        items[items.length - 1] = { type: "meta", message: msg, key: msg.uuid };
      } else {
        items.push({ type: "meta", message: msg, key: msg.uuid });
      }
      continue;
    }

    if (msg.role === "system" || msg.messageType === "system") {
      items.push({ type: "system", message: msg, key: msg.uuid });
      continue;
    }

    // Split message content: text/thinking blocks go to MessageCard,
    // tool_use/tool_result blocks are grouped into ToolCards
    const textBlocks: ContentBlock[] = [];
    const toolGroups: ContentBlock[][] = [];
    let currentToolGroup: ContentBlock[] = [];

    for (const block of msg.content) {
      if (block.type === "tool_use") {
        // Skip tool_use that will be paired with a cross-message tool_result
        if (block.id && consumedToolUseIds.has(block.id)) continue;
        currentToolGroup.push(block);
      } else if (block.type === "tool_result") {
        // Pair with matching tool_use from another message
        const matchingUse = block.tool_use_id ? toolUseById.get(block.tool_use_id) : undefined;
        if (matchingUse) {
          currentToolGroup = [matchingUse, block];
        } else {
          currentToolGroup.push(block);
        }
        toolGroups.push(currentToolGroup);
        currentToolGroup = [];
      } else {
        if (currentToolGroup.length > 0) {
          toolGroups.push(currentToolGroup);
          currentToolGroup = [];
        }
        textBlocks.push(block);
      }
    }
    if (currentToolGroup.length > 0) {
      toolGroups.push(currentToolGroup);
    }

    if (textBlocks.length > 0) {
      const textMsg: ChatMessage = {
        ...msg,
        content: textBlocks,
      };
      items.push({ type: "message", message: textMsg, key: msg.uuid });
    }

    for (let i = 0; i < toolGroups.length; i++) {
      items.push({
        type: "tool",
        toolBlocks: toolGroups[i],
        key: `${msg.uuid}-tool-${i}`,
      });
    }
  }

  return items;
}

export default function ChatPanel() {
  const store = useSession();

  // Persistent expanded state that survives virtual scroll recycling
  const expandedMap = new Map<string, boolean>();
  const [expandedVersion, setExpandedVersion] = createSignal(0);

  const expandedState: ExpandedState = {
    isExpanded(key: string, defaultValue: boolean): boolean {
      expandedVersion(); // track reactivity
      const val = expandedMap.get(key);
      if (val == null) {
        // Lazily initialize with default so toggle() always has a value to flip
        expandedMap.set(key, defaultValue);
        return defaultValue;
      }
      return val;
    },
    toggle(key: string) {
      const current = expandedMap.get(key) ?? false;
      expandedMap.set(key, !current);
      setExpandedVersion((v) => v + 1);
    },
  };

  // Clear expanded state when session changes
  createEffect(() => {
    store.state.activeSessionId; // track
    expandedMap.clear();
    setExpandedVersion(0);
  });

  const renderItems = createMemo(() =>
    buildRenderItems(store.activeMessages()),
  );

  const maxTokensInSession = createMemo(() => {
    let max = 0;
    for (const msg of store.activeMessages()) {
      const t = totalTokens(msg);
      if (t > max) max = t;
    }
    return max || 1;
  });

  // Lightbox state for chat images
  const [lightboxImages, setLightboxImages] = createSignal<GalleryImage[]>([]);
  const [lightboxIndex, setLightboxIndex] = createSignal<number | null>(null);

  function openLightbox(images: GalleryImage[], index: number) {
    setLightboxImages(images);
    setLightboxIndex(index);
  }

  /** Append a JSONL entry to the session file via backend. */
  function appendToJsonl(sessionId: string, entry: Record<string, unknown>) {
    const base = store.state.httpApiUrl;
    if (!base) return;
    fetch(`${base}/api/sessions/${sessionId}/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    }).catch((e) => console.warn("[chat] JSONL append failed:", e));
  }

  async function handleSend(payload: { text: string; images: ImageSource[] }) {
    const sessionId = store.state.activeSessionId;
    const base = store.state.httpApiUrl;
    if (!sessionId || !base) return;
    if (!payload.text && payload.images.length === 0) return;

    // Optimistic user message — appears immediately in chat
    const userUuid = crypto.randomUUID();
    const now = new Date().toISOString();
    const contentBlocks: ContentBlock[] = [];
    if (payload.text) {
      contentBlocks.push({ type: "text", text: payload.text });
    }
    for (const img of payload.images) {
      contentBlocks.push({ type: "image", source: img });
    }
    const optimisticMsg: ChatMessage = {
      uuid: userUuid,
      role: "user",
      messageType: "user",
      content: contentBlocks,
      timestamp: now,
    };
    store.addMessage(optimisticMsg);
    store.updateOrbState("streaming");

    // Send text via PTY input to Claude CLI
    if (payload.text) {
      try {
        const resp = await fetch(`${base}/api/sessions/${sessionId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: payload.text }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "unknown" }));
          console.warn("[chat] send failed:", err);
          store.updateOrbState("error");
          return;
        }
      } catch (e) {
        console.warn("[chat] send failed:", e);
        store.updateOrbState("error");
        return;
      }
    }

    // For image-only messages: append directly to JSONL
    if (payload.images.length > 0 && !payload.text) {
      appendToJsonl(sessionId, {
        parentUuid: null,
        isSidechain: false,
        userType: "external",
        sessionId,
        version: "noaide",
        type: "user",
        message: {
          role: "user",
          content: payload.images.map((img) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: img.media_type,
              data: img.data,
            },
          })),
        },
        uuid: userUuid,
        timestamp: now,
      });
    }

    // SSE push will deliver the assistant's response — no polling needed
  }

  return (
    <div class="chat-canvas"
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
      }}
    >
      {/* Header bar with orb, model badge, context meter */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 16px",
          "border-bottom": "1px solid var(--ctp-surface1)",
          background: "rgba(14,14,24,0.88)",
          "backdrop-filter": "blur(16px)",
          "-webkit-backdrop-filter": "blur(16px)",
          "min-height": "40px",
        }}
      >
        <BreathingOrb state={store.state.orbState} />
        <ModelBadge model={store.state.activeModel} />
        <div style={{ flex: "1" }}>
          <ContextMeter
            used={store.state.contextTokensUsed}
            max={store.state.contextTokensMax}
          />
        </div>
        <Show when={store.totalSessionCost() > 0}>
          <span
            style={{
              "font-size": "11px",
              color: "var(--ctp-subtext0)",
              "font-family": "var(--font-mono)",
            }}
          >
            ${store.totalSessionCost().toFixed(4)}
          </span>
        </Show>
      </div>

      {/* Messages area */}
      <div style={{ flex: "1", "min-height": "0" }}>
        <Show
          when={!store.state.loadingProgress.loading}
          fallback={
            <LoadingProgress progress={store.state.loadingProgress} />
          }
        >
          <Show
            when={renderItems().length > 0}
            fallback={
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  height: "100%",
                  color: "var(--ctp-overlay1)",
                  "flex-direction": "column",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    "font-family": "var(--font-mono)",
                    "font-size": "28px",
                    "font-weight": "800",
                    background: "linear-gradient(135deg, #00ff9d, #00b8ff)",
                    "-webkit-background-clip": "text",
                    "background-clip": "text",
                    "-webkit-text-fill-color": "transparent",
                    "letter-spacing": "-0.02em",
                  }}
                >
                  noaide
                </div>
                <div style={{
                  "font-size": "12px",
                  "font-family": "var(--font-mono)",
                  color: "var(--dim, #68687a)",
                  "letter-spacing": "0.05em",
                }}>
                  Select a session to begin
                </div>
              </div>
            }
          >
            <ExpandedProvider value={expandedState}>
              <VirtualScroller
                items={renderItems()}
                estimateHeight={80}
                overscan={5}
                getKey={(item) => item.key}
                renderItem={(item) => (
                  <ItemKeyProvider value={item.key}>
                    {(() => {
                      switch (item.type) {
                        case "system":
                          return <SystemMessage message={item.message!} />;
                        case "ghost":
                          return <GhostMessage message={item.message!} />;
                        case "tool":
                          return <ToolCard blocks={item.toolBlocks!} />;
                        case "meta":
                          return <MetaMessage message={item.message!} />;
                        case "message":
                        default:
                          return (
                            <MessageCard
                              message={item.message!}
                              maxTokens={maxTokensInSession()}
                              onImageClick={openLightbox}
                            />
                          );
                      }
                    })()}
                  </ItemKeyProvider>
                )}
              />
            </ExpandedProvider>
          </Show>
        </Show>
      </div>

      {/* Input field */}
      <InputField
        disabled={!store.state.activeSessionId}
        onSubmit={handleSend}
      />

      {/* Lightbox for chat images */}
      <Show when={lightboxIndex() !== null}>
        <Lightbox
          images={lightboxImages()}
          initialIndex={lightboxIndex()!}
          onClose={() => setLightboxIndex(null)}
        />
      </Show>
    </div>
  );
}
