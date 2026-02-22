import { Show, createMemo } from "solid-js";
import { useSession } from "../../App";
import type { ChatMessage, ContentBlock } from "../../types/messages";
import { totalTokens } from "../../types/messages";
import VirtualScroller from "./VirtualScroller";
import MessageCard from "./MessageCard";
import SystemMessage from "./SystemMessage";
import GhostMessage from "./GhostMessage";
import ToolCard from "./ToolCard";
import BreathingOrb from "./BreathingOrb";
import ContextMeter from "./ContextMeter";
import ModelBadge from "./ModelBadge";
import InputField from "./InputField";

/** Collect consecutive tool_use + tool_result blocks into a single ToolCard entry */
interface RenderItem {
  type: "message" | "system" | "ghost" | "tool";
  message?: ChatMessage;
  toolBlocks?: ContentBlock[];
  key: string;
}

function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];

  for (const msg of messages) {
    if (msg.isGhost) {
      items.push({ type: "ghost", message: msg, key: msg.uuid });
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
      if (block.type === "tool_use" || block.type === "tool_result") {
        currentToolGroup.push(block);
        if (block.type === "tool_result") {
          toolGroups.push(currentToolGroup);
          currentToolGroup = [];
        }
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

  function handleSend(text: string) {
    // Input will be sent via WebTransport to the active session
    // For now, log it — full PTY integration comes with session manager wiring
    // TODO: Send via WebTransport to active session (PTY integration)
    void text;
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--ctp-base)",
      }}
    >
      {/* Header bar with orb, model badge, context meter */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 16px",
          "border-bottom": "1px solid var(--ctp-surface0)",
          background: "var(--ctp-mantle)",
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
                  "font-size": "24px",
                  color: "var(--ctp-blue)",
                }}
              >
                noaide
              </div>
              <div style={{ "font-size": "13px" }}>
                Select a session to begin
              </div>
            </div>
          }
        >
          <VirtualScroller
            items={renderItems()}
            estimateHeight={80}
            overscan={5}
            renderItem={(item) => {
              switch (item.type) {
                case "system":
                  return <SystemMessage message={item.message!} />;
                case "ghost":
                  return <GhostMessage message={item.message!} />;
                case "tool":
                  return <ToolCard blocks={item.toolBlocks!} />;
                case "message":
                default:
                  return (
                    <MessageCard
                      message={item.message!}
                      maxTokens={maxTokensInSession()}
                    />
                  );
              }
            }}
          />
        </Show>
      </div>

      {/* Input field */}
      <InputField
        disabled={!store.state.activeSessionId}
        onSubmit={handleSend}
      />
    </div>
  );
}
