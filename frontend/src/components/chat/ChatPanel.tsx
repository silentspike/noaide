import { Show, createMemo, createSignal, createEffect, onMount, onCleanup } from "solid-js";
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
import WorkingIndicator from "./WorkingIndicator";
import ExportDialog from "../shared/ExportDialog";
import SearchBar from "./SearchBar";
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
  const [whisperUrl, setWhisperUrl] = createSignal<string | undefined>();

  // Fetch whisper availability from server-info
  onMount(async () => {
    try {
      // Fetch via same origin (Vite proxies /api/server-info to backend port 8080)
      // This avoids mixed content (http fetch from https page)
      const infoUrl = `${window.location.origin}/api/server-info`;
      console.warn("[chat] fetching server-info from", infoUrl);
      const res = await fetch(infoUrl);
      const info = await res.json();
      console.warn("[chat] server-info:", JSON.stringify(info));
      if (info.whisperEnabled) {
        // Use same origin (port 9999) — Vite proxies WS to backend port 8080
        // This avoids mixed content (wss from https page) since port 8080 has no TLS
        const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${wsProto}//${window.location.host}/api/ws/transcribe`;
        console.warn("[chat] whisper enabled — wsUrl:", url);
        setWhisperUrl(url);
      } else {
        console.warn("[chat] whisper not enabled in server-info");
      }
    } catch (e) {
      console.warn("[chat] server-info fetch failed (whisper unavailable):", e);
    }
  });

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

  // ── Incremental render-item builder ──────────────────────────────
  // Caches processed render items and only handles new messages
  // incrementally (O(k) where k = new messages, usually 1-5),
  // instead of rebuilding the entire list (O(n) for 55k+ messages).
  let riCache: RenderItem[] = [];
  let riProcessed = 0;
  let riToolUseMap = new Map<string, ContentBlock>();
  let riSessionId: string | null = null;
  let riMaxTokens = 0;

  const renderItems = createMemo(() => {
    // Explicit dependency: messagesVersion changes on every addMessage call.
    // activeMessages() returns the same store proxy reference (SolidJS memo
    // compares with ===), so without this signal renderItems never re-runs.
    store.messagesVersion();
    const messages = store.activeMessages();
    const sid = store.state.activeSessionId;

    // Reset on session change or shrink
    if (sid !== riSessionId || messages.length < riProcessed) {
      riCache = [];
      riProcessed = 0;
      riToolUseMap.clear();
      riSessionId = sid;
      riMaxTokens = 0;
    }

    // No new messages — same ref = no downstream re-render
    if (messages.length === 0 || messages.length === riProcessed) return riCache;

    // Full rebuild on initial load (session switch)
    if (riProcessed === 0) {
      riCache = buildRenderItems(messages);
      for (const msg of messages) {
        const t = totalTokens(msg);
        if (t > riMaxTokens) riMaxTokens = t;
        for (const block of msg.content) {
          if (block.type === "tool_use" && block.id) {
            riToolUseMap.set(block.id, block);
          }
        }
      }
      riProcessed = messages.length;
      return riCache;
    }

    // ── Incremental: only process new messages ──
    const newMsgs = messages.slice(riProcessed);

    // Track max tokens
    for (const msg of newMsgs) {
      const t = totalTokens(msg);
      if (t > riMaxTokens) riMaxTokens = t;
    }

    // Index new tool_use blocks
    for (const msg of newMsgs) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && block.id) {
          riToolUseMap.set(block.id, block);
        }
      }
    }

    // Find cross-message tool_results in new messages
    const consumed = new Set<string>();
    for (const msg of newMsgs) {
      const hasResult = msg.content.some((b) => b.type === "tool_result");
      const hasUse = msg.content.some((b) => b.type === "tool_use");
      if (hasResult && !hasUse) {
        for (const block of msg.content) {
          if (block.type === "tool_result" && block.tool_use_id) {
            consumed.add(block.tool_use_id);
          }
        }
      }
    }

    // Remove cached items whose tool_use is now consumed
    if (consumed.size > 0) {
      riCache = riCache.filter((item) => {
        if (item.type !== "tool") return true;
        return !item.toolBlocks?.some(
          (b) => b.type === "tool_use" && b.id && consumed.has(b.id),
        );
      });
    }

    // Append render items for new messages
    for (const msg of newMsgs) {
      if (msg.isGhost) {
        riCache.push({ type: "ghost", message: msg, key: msg.uuid });
        continue;
      }
      if (msg.role === "meta") {
        const metaText = msg.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        if (!metaText.trim()) continue;
        const prev = riCache[riCache.length - 1];
        if (prev?.type === "meta" && prev.message?.messageType === msg.messageType) {
          riCache[riCache.length - 1] = { type: "meta", message: msg, key: msg.uuid };
        } else {
          riCache.push({ type: "meta", message: msg, key: msg.uuid });
        }
        continue;
      }
      if (msg.role === "system" || msg.messageType === "system") {
        riCache.push({ type: "system", message: msg, key: msg.uuid });
        continue;
      }

      const textBlocks: ContentBlock[] = [];
      const toolGroups: ContentBlock[][] = [];
      let currentToolGroup: ContentBlock[] = [];
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          if (block.id && consumed.has(block.id)) continue;
          currentToolGroup.push(block);
        } else if (block.type === "tool_result") {
          const matchingUse = block.tool_use_id
            ? riToolUseMap.get(block.tool_use_id)
            : undefined;
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
        riCache.push({
          type: "message",
          message: { ...msg, content: textBlocks },
          key: msg.uuid,
        });
      }
      for (let i = 0; i < toolGroups.length; i++) {
        riCache.push({
          type: "tool",
          toolBlocks: toolGroups[i],
          key: `${msg.uuid}-tool-${i}`,
        });
      }
    }

    riProcessed = messages.length;
    riCache = riCache.slice(); // new ref for SolidJS reactivity
    return riCache;
  });

  const emptyState = createMemo(() => {
    const activeSessionId = store.state.activeSessionId;
    if (!activeSessionId) {
      return {
        title: "noaide",
        subtitle: "Select a session to begin",
      };
    }

    const session = store.activeSession();
    if (!session) {
      return {
        title: "Loading session",
        subtitle: "Syncing the selected session...",
      };
    }

    if (store.state.orbState !== "idle" || session.status === "active") {
      return {
        title: "Session starting",
        subtitle: "The CLI is booting. You can send the first message once the prompt is ready.",
      };
    }

    return {
      title: "Session ready",
      subtitle: "Send the first message to begin this conversation.",
    };
  });

  const maxTokensInSession = createMemo(() => {
    renderItems(); // reactive dependency
    return riMaxTokens || 1;
  });

  // Export dialog state
  const [exportOpen, setExportOpen] = createSignal(false);

  // Search state
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchMatches, setSearchMatches] = createSignal<number[]>([]);
  const [currentMatchIdx, setCurrentMatchIdx] = createSignal(0);

  // Cmd+F handler
  onMount(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  function handleSearch(query: string) {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchMatches([]);
      setCurrentMatchIdx(0);
      return;
    }
    const q = query.toLowerCase();
    const items = renderItems();
    const matches: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.message) {
        const text = item.message.content
          .map((b) => b.text ?? b.thinking ?? "")
          .join(" ")
          .toLowerCase();
        if (text.includes(q)) matches.push(i);
      }
    }
    setSearchMatches(matches);
    setCurrentMatchIdx(0);
  }

  function searchNext() {
    const matches = searchMatches();
    if (matches.length === 0) return;
    setCurrentMatchIdx((i) => (i + 1) % matches.length);
  }

  function searchPrev() {
    const matches = searchMatches();
    if (matches.length === 0) return;
    setCurrentMatchIdx((i) => (i - 1 + matches.length) % matches.length);
  }

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
    store.addOptimisticUserMessage(optimisticMsg);
    store.updateOrbState("streaming");

    // Queue images for proxy injection (if any)
    // The proxy will inject these into the next /v1/messages API call
    if (payload.images.length > 0) {
      const imageBlocks = payload.images.map((img) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: img.media_type,
          data: img.data,
        },
      }));
      try {
        await fetch(`${base}/api/sessions/${sessionId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: imageBlocks }),
        });
      } catch (e) {
        console.warn("[chat] image queue failed:", e);
      }

      // Append to JSONL for display in conversation history.
      // Only for Claude sessions (JSONL format). Gemini/Codex session files
      // are single JSON objects — appending would corrupt them.
      const activeCliType = store.activeSession()?.cliType;
      if (activeCliType === "claude" || !activeCliType) {
        appendToJsonl(sessionId, {
          parentUuid: null,
          isSidechain: false,
          userType: "external",
          sessionId,
          version: "noaide",
          type: "user",
          message: {
            role: "user",
            content: [
              ...(payload.text ? [{ type: "text" as const, text: payload.text }] : []),
              ...imageBlocks,
            ],
          },
          uuid: userUuid,
          timestamp: now,
        });
      }
    }

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
        <div style={{ flex: "1", "min-width": "0", overflow: "hidden" }}>
          <ContextMeter
            used={store.state.contextTokensUsed}
            max={store.state.contextTokensMax}
          />
        </div>
        <Show when={store.state.orbState === "streaming" || store.state.orbState === "thinking" || store.state.orbState === "tool_use"}>
          <span
            data-testid="streaming-progress"
            style={{
              "font-size": "11px",
              color: "var(--ctp-blue)",
              "font-family": "var(--font-mono)",
              "white-space": "nowrap",
            }}
          >
            {Math.min(Math.round((store.state.contextTokensUsed / Math.max(store.state.contextTokensMax, 1)) * 100), 100)}%
          </span>
        </Show>
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
        <Show when={store.state.activeSessionId}>
          <button
            title="Export session"
            onClick={() => setExportOpen(true)}
            style={{
              background: "none",
              border: "1px solid var(--ctp-surface1)",
              "border-radius": "4px",
              padding: "3px 8px",
              cursor: "pointer",
              color: "var(--ctp-overlay1)",
              "font-size": "10px",
              "font-weight": "600",
              "font-family": "var(--font-mono)",
              "text-transform": "uppercase",
              "letter-spacing": "0.06em",
              transition: "all 150ms ease",
              "flex-shrink": "0",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--neon-blue, #00b8ff)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--neon-blue, #00b8ff)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--ctp-surface1)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--ctp-overlay1)";
            }}
          >
            Export
          </button>
        </Show>
      </div>

      {/* Search bar */}
      <SearchBar
        open={searchOpen()}
        onClose={() => setSearchOpen(false)}
        onSearch={handleSearch}
        onNext={searchNext}
        onPrev={searchPrev}
        matchCount={searchMatches().length}
        currentMatch={currentMatchIdx()}
      />

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
                  {emptyState().title}
                </div>
                <div style={{
                  "font-size": "12px",
                  "font-family": "var(--font-mono)",
                  color: "var(--dim, #68687a)",
                  "letter-spacing": "0.05em",
                }}>
                  {emptyState().subtitle}
                </div>
              </div>
            }
          >
            <ExpandedProvider value={expandedState}>
              {/* Loading older indicator */}
              <Show when={store.loadingOlder()}>
                <div style={{
                  "text-align": "center",
                  padding: "8px",
                  "font-size": "11px",
                  "font-family": "var(--font-mono)",
                  color: "var(--ctp-overlay1)",
                }}>
                  Loading older messages...
                </div>
              </Show>
              <VirtualScroller
                items={renderItems()}
                estimateHeight={80}
                overscan={5}
                getKey={(item) => item.key}
                onScrollNearTop={() => store.fetchOlderMessages()}
                renderItem={(item) => (
                  <ItemKeyProvider value={item.key}>
                    {(() => {
                      switch (item.type) {
                        case "system":
                          return <SystemMessage message={item.message!} />;
                        case "ghost":
                          return <GhostMessage message={item.message!} />;
                        case "tool":
                          return <ToolCard blocks={item.toolBlocks!} onImageClick={openLightbox} />;
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

      {/* Working indicator */}
      <WorkingIndicator
        orbState={store.state.orbState}
        contextTokensUsed={store.state.contextTokensUsed}
      />

      {/* Input field */}
      <InputField
        disabled={!store.state.activeSessionId}
        onSubmit={handleSend}
        whisperUrl={whisperUrl()}
      />

      {/* Lightbox for chat images */}
      <Show when={lightboxIndex() !== null}>
        <Lightbox
          images={lightboxImages()}
          initialIndex={lightboxIndex()!}
          onClose={() => setLightboxIndex(null)}
        />
      </Show>

      {/* Export dialog */}
      <ExportDialog
        open={exportOpen()}
        onClose={() => setExportOpen(false)}
        messages={store.activeMessages()}
        sessionName={store.activeSession()?.path ?? "session"}
      />
    </div>
  );
}
