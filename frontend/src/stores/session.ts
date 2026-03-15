import { createStore, reconcile } from "solid-js/store";
import { createMemo, createSignal, batch } from "solid-js";
import type { ConnectionStatus } from "../transport/client";
import type { QualityTier, EventEnvelope } from "../transport/codec";
import type { ChatMessage, OrbState, ContentBlock } from "../types/messages";
import { incrementEventCounter } from "../lib/profiler-metrics";

/** Shape returned by the API and pushed via WebTransport bus events. */
type MessageRow = {
  uuid: string;
  sessionId: string;
  role: string;
  content: string;
  contentBlocks: ContentBlock[] | null;
  timestamp: number;
  tokens: number | null;
  hidden: boolean;
  messageType: string;
  model: string | null;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
};

export interface Session {
  id: string;
  path: string;
  status: "active" | "idle" | "archived" | "error";
  model?: string;
  startedAt: number;
  /** Most recent activity timestamp (updated on bus events), used for sort. */
  lastActivityAt: number;
  messageCount: number;
  cost?: number;
  cliType?: "claude" | "codex" | "gemini";
}

export interface LoadingProgress {
  loading: boolean;
  bytesLoaded: number;
  bytesTotal: number;
  startTime: number;
  messagesExpected: number;
}

export interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  connectionStatus: ConnectionStatus;
  qualityTier: QualityTier;
  messages: ChatMessage[];
  orbState: OrbState;
  activeModel: string | null;
  contextTokensUsed: number;
  contextTokensMax: number;
  httpApiUrl: string | null;
  loadingProgress: LoadingProgress;
  /** Bookmarked message UUIDs (persisted in localStorage). */
  bookmarks: Set<string>;
}

/** Map model name to context window size (tokens). */
function modelContextWindow(model: string | null | undefined): number {
  if (!model) return 200_000;
  const m = model.toLowerCase();

  // Gemini models — 1M context
  if (m.includes("gemini")) return 1_048_576;

  // Codex / OpenAI models
  if (m.includes("codex")) return 258_400;
  if (m.includes("o3")) return 200_000;
  if (m.includes("o4-mini") || m.includes("o1")) return 200_000;
  if (m.includes("gpt-4o")) return 128_000;
  if (m.includes("gpt-4")) return 128_000;
  if (m.includes("gpt-3.5")) return 16_385;

  // Claude models — 200K context
  if (m.includes("claude")) return 200_000;

  return 200_000;
}

export function createSessionStore() {
  // AbortController for in-flight fetchMessages — abort on session switch
  let fetchAbortController: AbortController | null = null;

  // Pinned sessions — persisted in localStorage
  const PINNED_KEY = "noaide-pinned-sessions";
  const loadPinned = (): Set<string> => {
    try {
      const raw = localStorage.getItem(PINNED_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  };
  const [pinnedIds, setPinnedIds] = createSignal<Set<string>>(loadPinned());
  const savePinned = (ids: Set<string>) => {
    localStorage.setItem(PINNED_KEY, JSON.stringify([...ids]));
  };
  const pinSession = (id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      savePinned(next);
      return next;
    });
    setSessionsVersion((v) => v + 1);
  };
  const unpinSession = (id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      savePinned(next);
      return next;
    });
    setSessionsVersion((v) => v + 1);
  };
  const isPinned = (id: string) => pinnedIds().has(id);
  const togglePin = (id: string) => isPinned(id) ? unpinSession(id) : pinSession(id);

  const [state, setState] = createStore<SessionState>({
    sessions: [],
    activeSessionId: null,
    connectionStatus: "disconnected",
    qualityTier: "Full",
    messages: [],
    orbState: "idle",
    activeModel: null,
    contextTokensUsed: 0,
    contextTokensMax: 200_000,
    httpApiUrl: null,
    loadingProgress: {
      loading: false,
      bytesLoaded: 0,
      bytesTotal: 0,
      startTime: 0,
      messagesExpected: 0,
    },
    bookmarks: new Set<string>(),
  });

  // Bumped on every fetchSessions / bus event that changes session data.
  // Dependents (e.g., sorted session list) read this to guarantee re-evaluation.
  const [sessionsVersion, setSessionsVersion] = createSignal(0);

  // Bumped on every addMessage / fetchMessages call.
  // SolidJS fine-grained store updates (setState("messages", N, msg)) do NOT
  // trigger property-level subscribers of state.messages — only index-level.
  // Memos like activeMessages/renderItems need this explicit signal to re-evaluate.
  const [messagesVersion, setMessagesVersion] = createSignal(0);

  const activeSession = createMemo(
    () => state.sessions.find((s) => s.id === state.activeSessionId) ?? null,
  );

  const activeSessions = createMemo(() =>
    state.sessions.filter(
      (s) => s.status === "active" || s.status === "idle",
    ),
  );

  const sessionCount = createMemo(() => state.sessions.length);

  const activeMessages = createMemo(() => {
    const sid = state.activeSessionId;
    if (!sid) return [];
    messagesVersion(); // explicit dependency — re-evaluate when messages change
    return state.messages;
  });

  const [totalSessionCost, setTotalSessionCost] = createSignal(0);
  const [hasMoreMessages, setHasMoreMessages] = createSignal(false);
  const [totalMessageCount, setTotalMessageCount] = createSignal(0);
  const [loadingOlder, setLoadingOlder] = createSignal(false);

  function setHttpApiUrl(url: string) {
    setState("httpApiUrl", url);
  }

  async function fetchSessions() {
    const base = state.httpApiUrl;
    if (!base) return;

    try {
      const resp = await fetch(`${base}/api/sessions`);
      if (!resp.ok) return;
      const data: Array<{
        id: string;
        path: string;
        status: string;
        model: string | null;
        startedAt: number;
        lastActivityAt: number;
        cost: number | null;
        messageCount: number;
        cliType?: string;
      }> = await resp.json();

      // Dedup: API may return duplicate session IDs (managed + observed pairs)
      const seen = new Set<string>();
      const deduped = data.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });

      // Batch-update all sessions in one reactive flush
      const sessions: Session[] = deduped.map((s) => ({
        id: s.id,
        path: s.path,
        status: mapStatus(s.status),
        model: s.model ?? undefined,
        startedAt: s.startedAt * 1000,
        lastActivityAt: (s.lastActivityAt || s.startedAt) * 1000,
        messageCount: s.messageCount,
        cost: s.cost ?? undefined,
        cliType: (s.cliType as Session["cliType"]) ?? "claude",
      }));
      batch(() => {
        setState("sessions", reconcile(sessions, { key: "id" }));
        setSessionsVersion((v) => v + 1);
      });
    } catch (e) {
      console.warn("[session] fetchSessions failed:", e);
    }
  }

  async function fetchMessages(sessionId: string, silent = false) {
    const base = state.httpApiUrl;
    if (!base) {
      console.warn("[session] fetchMessages: no httpApiUrl set");
      return;
    }

    // Find expected message count from session metadata
    const session = state.sessions.find((s) => s.id === sessionId);
    const expectedMsgs = session?.messageCount ?? 0;

    // Only show loading indicator for initial loads (not event-triggered refreshes)
    if (!silent) {
      batch(() => {
        setState("loadingProgress", {
          loading: true,
          bytesLoaded: 0,
          bytesTotal: 0,
          startTime: Date.now(),
          messagesExpected: expectedMsgs,
        });
      });
    }

    // Abort any previous in-flight fetchMessages request
    if (fetchAbortController) {
      fetchAbortController.abort();
    }
    fetchAbortController = new AbortController();
    const signal = fetchAbortController.signal;

    try {
      const resp = await fetch(`${base}/api/sessions/${sessionId}/messages?limit=200`, { signal });
      if (!resp.ok) {
        console.warn(`[session] fetchMessages: HTTP ${resp.status} ${resp.statusText}`);
        if (!silent) setState("loadingProgress", "loading", false);
        return;
      }

      // Read Content-Length for progress calculation
      const contentLength = parseInt(resp.headers.get("Content-Length") ?? "0", 10);
      if (!silent && contentLength > 0) {
        setState("loadingProgress", "bytesTotal", contentLength);
      }

      // Stream response body for progress tracking (throttle UI updates to ~10/sec)
      let bodyText: string;
      if (!silent && resp.body && contentLength > 50_000) {
        const reader = resp.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        let lastProgressUpdate = 0;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;

          // Throttle progress updates: max every 100ms
          const now = performance.now();
          if (now - lastProgressUpdate > 100) {
            setState("loadingProgress", "bytesLoaded", loaded);
            lastProgressUpdate = now;
          }
        }
        // Final progress update
        setState("loadingProgress", "bytesLoaded", loaded);

        // Concatenate chunks and decode
        const fullBuffer = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          fullBuffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        bodyText = new TextDecoder().decode(fullBuffer);
      } else {
        bodyText = await resp.text();
        if (!silent) {
          setState("loadingProgress", "bytesLoaded", bodyText.length);
        }
      }

      // Early staleness check after network I/O
      if (state.activeSessionId !== sessionId) {
        if (!silent) setState("loadingProgress", "loading", false);
        return;
      }

      // Parse JSON (can be slow for large responses — yield to UI first)
      await new Promise((r) => setTimeout(r, 0));

      let data: MessageRow[];

      try {
        const parsed = JSON.parse(bodyText);
        // Support paginated response { messages: [...], total: N, hasMore } and legacy array
        if (Array.isArray(parsed)) {
          data = parsed;
          setHasMoreMessages(false);
          setTotalMessageCount(parsed.length);
        } else if (parsed && Array.isArray(parsed.messages)) {
          data = parsed.messages;
          setHasMoreMessages(parsed.hasMore === true);
          setTotalMessageCount(parsed.total ?? parsed.messages.length);
        } else {
          console.error("[session] fetchMessages: unexpected response format");
          if (!silent) setState("loadingProgress", "loading", false);
          return;
        }
      } catch (parseErr) {
        console.error("[session] fetchMessages: JSON.parse failed on", bodyText.length, "chars:", parseErr);
        if (!silent) setState("loadingProgress", "loading", false);
        return;
      }

      // Release the large string early to free memory
      bodyText = "";

      // Staleness guard: if the user switched sessions while we were fetching,
      // discard the response — otherwise we'd overwrite the new session's messages
      // with the old session's data (race condition on rapid session switching).
      if (state.activeSessionId !== sessionId) {
        console.warn(`[session] fetchMessages: stale response for ${sessionId}, active is ${state.activeSessionId}`);
        if (!silent) setState("loadingProgress", "loading", false);
        return;
      }

      // Convert all messages and populate seenUuids for dedup
      const converted: ChatMessage[] = new Array(data.length);
      let totalTokenCount = 0;
      let lastModel: string | undefined;
      let totalCost = 0;

      for (let i = 0; i < data.length; i++) {
        const m = data[i];
        converted[i] = convertMessageRow(m);
        totalCost += converted[i].costUsd ?? 0;
        seenUuids.add(m.uuid);

        // Context window usage = input_tokens + cache_creation + cache_read
        // (Claude's prompt caching splits the total across these three fields).
        // Use the LAST assistant response's values.
        const ctxUsed = (m.inputTokens ?? 0)
          + (m.cacheCreationInputTokens ?? 0)
          + (m.cacheReadInputTokens ?? 0);
        if (ctxUsed > 0) {
          totalTokenCount = ctxUsed;
        }

        if (m.model) lastModel = m.model;
      }

      // Derive orbState from the last message (detects streaming/thinking/tool_use)
      let derivedOrb: OrbState = "idle";
      if (converted.length > 0) {
        const last = converted[converted.length - 1];
        if (last.content.some((b) => b.is_error)) {
          derivedOrb = "error";
        } else if (last.role === "assistant" && !last.stopReason) {
          // No stop_reason = still streaming
          if (last.content.some((b) => b.type === "thinking")) {
            derivedOrb = "thinking";
          } else if (last.content.some((b) => b.type === "tool_use")) {
            derivedOrb = "tool_use";
          } else {
            derivedOrb = "streaming";
          }
        }
      }

      // Single batch update — replaces array once for initial load.
      // After this, all updates come through addMessage (fine-grained).
      batch(() => {
        setState("messages", converted);
        setMessagesVersion((v) => v + 1);
        setState("contextTokensUsed", totalTokenCount);
        setTotalSessionCost(totalCost);
        setState("orbState", derivedOrb);
        if (lastModel) {
          setState("activeModel", lastModel);
          setState("contextTokensMax", modelContextWindow(lastModel));
        }
        if (!silent) setState("loadingProgress", "loading", false);
      });
    } catch (e) {
      // AbortError is expected when user switches sessions — don't log as error
      if (e instanceof DOMException && e.name === "AbortError") {
        if (!silent) setState("loadingProgress", "loading", false);
        return;
      }
      console.error("[session] fetchMessages failed:", e);
      if (!silent) setState("loadingProgress", "loading", false);
    }
  }

  async function fetchOlderMessages() {
    const sessionId = state.activeSessionId;
    const base = state.httpApiUrl;
    if (!sessionId || !base || loadingOlder() || !hasMoreMessages()) return;

    setLoadingOlder(true);
    try {
      const currentCount = state.messages.length;
      const offset = totalMessageCount() - currentCount + state.messages.length;
      const resp = await fetch(
        `${base}/api/sessions/${sessionId}/messages?limit=200&offset=${offset}`,
      );
      if (!resp.ok) return;
      const parsed = await resp.json();
      const rows: MessageRow[] = parsed.messages ?? parsed;

      if (rows.length === 0) {
        setHasMoreMessages(false);
        return;
      }

      const olderMsgs: ChatMessage[] = [];
      for (const m of rows) {
        if (!seenUuids.has(m.uuid)) {
          seenUuids.add(m.uuid);
          olderMsgs.push(convertMessageRow(m));
        }
      }

      if (olderMsgs.length > 0) {
        batch(() => {
          // Prepend older messages
          setState("messages", (prev) => [...olderMsgs, ...prev]);
          setMessagesVersion((v) => v + 1);
        });
      }

      setHasMoreMessages(parsed.hasMore === true);
    } catch (e) {
      console.warn("[session] fetchOlderMessages failed:", e);
    } finally {
      setLoadingOlder(false);
    }
  }

  function setActiveSession(id: string | null) {
    if (id === state.activeSessionId) return;

    // Abort any in-flight fetchMessages for the previous session
    if (fetchAbortController) {
      fetchAbortController.abort();
      fetchAbortController = null;
    }

    seenUuids.clear();
    batch(() => {
      setState("activeSessionId", id);
      setState("messages", []);
      setState("contextTokensUsed", 0);
      setState("loadingProgress", "loading", false);
    });
    setTotalSessionCost(0);
    if (id) {
      fetchMessages(id, false); // initial load with loading indicator
      // Realtime push arrives via WebTransport (ADR-8) through handleEvent()
    }
  }

  function updateConnectionStatus(status: ConnectionStatus) {
    setState("connectionStatus", status);
  }

  function updateQualityTier(tier: QualityTier) {
    setState("qualityTier", tier);
  }

  function updateOrbState(orbState: OrbState) {
    setState("orbState", orbState);
  }

  function upsertSession(session: Session) {
    setState("sessions", (sessions) => {
      const idx = sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        const updated = [...sessions];
        updated[idx] = session;
        return updated;
      }
      return [...sessions, session];
    });
  }

  function removeSession(id: string) {
    setState("sessions", (sessions) => sessions.filter((s) => s.id !== id));
    if (state.activeSessionId === id) {
      setState("activeSessionId", null);
    }
  }

  // UUID set for O(1) dedup — survives across addMessage calls
  const seenUuids = new Set<string>();

  // Track optimistic user messages so parser-delivered duplicates are skipped.
  // When the user sends via PTY, ChatPanel adds an optimistic message immediately
  // (with crypto.randomUUID()). The parser later delivers the same message with a
  // different UUID (from the LLM's session file). Without this, both appear in chat.
  const pendingOptimisticUserUuids = new Set<string>();

  function addOptimisticUserMessage(msg: ChatMessage) {
    pendingOptimisticUserUuids.add(msg.uuid);
    addMessage(msg);
  }

  function addMessage(msg: ChatMessage) {
    // O(1) dedup via Set instead of O(n) array scan
    if (seenUuids.has(msg.uuid)) return;

    // Skip parser-delivered user messages when we already have an optimistic copy.
    // The optimistic version stays (preserves original text including punctuation
    // that LLMs like Gemini strip). We add the new UUID to seenUuids so re-parses
    // are also deduped.
    if (msg.role === "user" && pendingOptimisticUserUuids.size > 0
        && !pendingOptimisticUserUuids.has(msg.uuid)) {
      // Pop the oldest pending optimistic UUID
      const oldest = pendingOptimisticUserUuids.values().next().value!;
      pendingOptimisticUserUuids.delete(oldest);
      seenUuids.add(msg.uuid); // prevent future re-adds of the parsed version
      return;
    }

    seenUuids.add(msg.uuid);

    // Fine-grained append: set at specific index, SolidJS only
    // re-renders the NEW item, not the entire list. No array copy.
    setState("messages", state.messages.length, msg);
    setMessagesVersion((v) => v + 1);
    setTotalSessionCost((prev) => prev + (msg.costUsd ?? 0));

    if (msg.model) {
      setState("activeModel", msg.model);
      setState("contextTokensMax", modelContextWindow(msg.model));
    }

    // Context window usage = input_tokens + cache_creation + cache_read
    // (Claude's prompt caching splits the total across these three fields).
    const ctxUsed = (msg.inputTokens ?? 0)
      + (msg.cacheCreationInputTokens ?? 0)
      + (msg.cacheReadInputTokens ?? 0);
    if (ctxUsed > 0) {
      setState("contextTokensUsed", ctxUsed);
    }

    if (msg.stopReason === "end_turn") {
      setState("orbState", "idle");
    } else if (msg.content.some((b) => b.type === "thinking")) {
      setState("orbState", "thinking");
    } else if (msg.content.some((b) => b.type === "tool_use")) {
      setState("orbState", "tool_use");
    } else if (msg.role === "assistant" && !msg.stopReason) {
      setState("orbState", "streaming");
    }

    if (msg.content.some((b) => b.is_error)) {
      setState("orbState", "error");
    }
  }

  function handleEvent(topic: string, envelope: EventEnvelope) {
    incrementEventCounter();
    switch (topic) {
      case "session/messages": {
        if (envelope.sessionId) {
          const sid = envelope.sessionId;
          const now = Date.now();
          // Push messages directly if this is the active session
          if (state.activeSessionId === sid && envelope.payload) {
            try {
              const payloadStr = new TextDecoder().decode(envelope.payload);
              const payload = JSON.parse(payloadStr);
              if (payload?.type === "new_messages" && Array.isArray(payload.messages)) {
                batch(() => {
                  setState(
                    "sessions",
                    (s) => s.id === sid,
                    "messageCount",
                    (c) => c + payload.messages.length,
                  );
                  setState("sessions", (s) => s.id === sid, "lastActivityAt", now);
                  for (const m of payload.messages) {
                    addMessage(convertMessageRow(m));
                  }
                });
              }
            } catch (e) {
              console.warn("[handleEvent] failed to parse payload:", e);
            }
          } else {
            // Not active session — just update count and activity timestamp
            batch(() => {
              setState(
                "sessions",
                (s) => s.id === sid,
                "messageCount",
                (c) => c + 1,
              );
              setState("sessions", (s) => s.id === sid, "lastActivityAt", now);
            });
          }
        }
        break;
      }
      case "system/events":
        break;
    }
  }

  return {
    state,
    activeSession,
    activeSessions,
    sessionCount,
    activeMessages,
    totalSessionCost,
    sessionsVersion,
    messagesVersion,
    pinnedIds,
    isPinned,
    pinSession,
    unpinSession,
    togglePin,
    setHttpApiUrl,
    fetchSessions,
    fetchMessages,
    fetchOlderMessages,
    hasMoreMessages,
    loadingOlder,
    totalMessageCount,
    setActiveSession,
    updateConnectionStatus,
    updateQualityTier,
    updateOrbState,
    upsertSession,
    removeSession,
    addMessage,
    addOptimisticUserMessage,
    handleEvent,
    // Bookmarks
    isBookmarked: (uuid: string) => state.bookmarks.has(uuid),
    toggleBookmark: (uuid: string) => {
      const next = new Set(state.bookmarks);
      if (next.has(uuid)) next.delete(uuid); else next.add(uuid);
      setState("bookmarks", next);
      // Persist
      const sid = state.activeSessionId;
      if (sid) localStorage.setItem(`noaide-bookmarks-${sid}`, JSON.stringify([...next]));
    },
    loadBookmarks: (sessionId: string) => {
      try {
        const raw = localStorage.getItem(`noaide-bookmarks-${sessionId}`);
        if (raw) setState("bookmarks", new Set(JSON.parse(raw)));
        else setState("bookmarks", new Set());
      } catch { setState("bookmarks", new Set()); }
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;

// --- Helpers ---

function mapStatus(s: string): Session["status"] {
  switch (s) {
    case "active": return "active";
    case "idle": return "idle";
    case "archived": return "archived";
    case "error": return "error";
    default: return "idle";
  }
}

function mapRole(r: string): "user" | "assistant" | "system" | "meta" {
  switch (r) {
    case "user": return "user";
    case "assistant": return "assistant";
    case "system": return "system";
    case "meta": return "meta";
    default: return "user";
  }
}

/** Convert flat content string + messageType into ContentBlock array */
function parseContentToBlocks(content: string, messageType: string): ContentBlock[] {
  if (!content) return [{ type: "text", text: "" }];

  switch (messageType) {
    case "Thinking":
      return [{ type: "thinking", thinking: content }];
    case "ToolUse":
    case "ToolResult":
    case "SystemReminder":
    case "Progress":
    case "Summary":
    case "FileSnapshot":
      return [{ type: "text", text: content }];
    default:
      return [{ type: "text", text: content }];
  }
}

/** Convert a MessageRow (from API or WebTransport payload) to a ChatMessage for the store. */
function convertMessageRow(m: MessageRow): ChatMessage {
  const contentBlocks = m.contentBlocks && m.contentBlocks.length > 0
    ? m.contentBlocks
    : parseContentToBlocks(m.content, m.messageType);

  return {
    uuid: m.uuid,
    role: mapRole(m.role),
    messageType: m.messageType.toLowerCase(),
    content: contentBlocks,
    timestamp: m.timestamp > 0 ? new Date(m.timestamp * 1000).toISOString() : undefined,
    model: m.model ?? undefined,
    stopReason: m.stopReason ?? undefined,
    inputTokens: m.inputTokens ?? undefined,
    outputTokens: m.outputTokens ?? undefined,
    cacheCreationInputTokens: m.cacheCreationInputTokens ?? undefined,
    cacheReadInputTokens: m.cacheReadInputTokens ?? undefined,
    hidden: m.hidden,
  };
}
