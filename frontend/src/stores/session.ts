import { createStore, reconcile } from "solid-js/store";
import { createMemo, createSignal, batch } from "solid-js";
import type { ConnectionStatus } from "../transport/client";
import type { QualityTier, EventEnvelope } from "../transport/codec";
import type { ChatMessage, OrbState, ContentBlock } from "../types/messages";

/** Shape returned by the API and pushed via SSE bus events. */
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
  /** Most recent activity timestamp (updated on SSE events), used for sort. */
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
  });

  // Bumped on every fetchSessions / bus event that changes session data.
  // Dependents (e.g., sorted session list) read this to guarantee re-evaluation.
  const [sessionsVersion, setSessionsVersion] = createSignal(0);

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
    return state.messages;
  });

  const totalSessionCost = createMemo(() =>
    state.messages.reduce((sum, m) => sum + (m.costUsd ?? 0), 0),
  );

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

      // Batch-update all sessions in one reactive flush
      const sessions: Session[] = data.map((s) => ({
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

    // Only show loading indicator for initial loads (not SSE-triggered refreshes)
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

    try {
      const resp = await fetch(`${base}/api/sessions/${sessionId}/messages`);
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

      // Parse JSON (can be slow for large responses — yield to UI first)
      await new Promise((r) => setTimeout(r, 0));

      let data: MessageRow[];

      try {
        const parsed = JSON.parse(bodyText);
        // Support paginated response { messages: [...], total: N } and legacy array
        if (Array.isArray(parsed)) {
          data = parsed;
        } else if (parsed && Array.isArray(parsed.messages)) {
          data = parsed.messages;
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

      // Convert all messages and populate seenUuids for dedup
      const converted: ChatMessage[] = new Array(data.length);
      let totalTokenCount = 0;
      let lastModel: string | undefined;

      for (let i = 0; i < data.length; i++) {
        const m = data[i];
        converted[i] = convertMessageRow(m);
        seenUuids.add(m.uuid);

        // inputTokens on an assistant response = current context window usage
        // (includes entire conversation up to that point). Use the LAST value.
        if (m.inputTokens && m.inputTokens > 0) {
          totalTokenCount = m.inputTokens;
        }

        if (m.model) lastModel = m.model;
      }

      // Single batch update — replaces array once for initial load.
      // After this, all updates come through addMessage (fine-grained).
      batch(() => {
        setState("messages", converted);
        setState("contextTokensUsed", totalTokenCount);
        if (lastModel) {
          setState("activeModel", lastModel);
          setState("contextTokensMax", modelContextWindow(lastModel));
        }
        if (!silent) setState("loadingProgress", "loading", false);
      });
    } catch (e) {
      console.error("[session] fetchMessages failed:", e);
      if (!silent) setState("loadingProgress", "loading", false);
    }
  }

  // SSE connection for realtime event streaming
  let sseConnection: EventSource | null = null;

  function connectSSE(sessionId: string) {
    disconnectSSE();
    const base = state.httpApiUrl;
    if (!base) return;

    const url = `${base}/api/events?session_id=${sessionId}&topics=session/messages`;
    const es = new EventSource(url);

    es.addEventListener("session/messages", (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        // Defense-in-depth: verify session_id matches active session
        if (data.session_id && data.session_id !== sessionId) return;

        // payload is a JSON string (from Rust's String::from_utf8_lossy)
        const payload = typeof data.payload === "string"
          ? JSON.parse(data.payload)
          : data.payload;

        if (payload?.type === "new_messages" && Array.isArray(payload.messages)) {
          batch(() => {
            // Update last activity timestamp for sort order
            setState("sessions", (s) => s.id === sessionId, "lastActivityAt", Date.now());
            for (const m of payload.messages) {
              addMessage(convertMessageRow(m));
            }
          });
        }
      } catch (e) {
        console.warn("[sse] failed to parse event payload:", e);
      }
    });

    es.onerror = () => {};
    es.onopen = () => {
      console.warn("[sse] connected for session", sessionId);
    };

    sseConnection = es;
  }

  function disconnectSSE() {
    if (sseConnection) {
      sseConnection.close();
      sseConnection = null;
    }
  }

  function setActiveSession(id: string | null) {
    if (id === state.activeSessionId) return;
    disconnectSSE();
    seenUuids.clear();
    setState("activeSessionId", id);
    setState("messages", []);
    setState("contextTokensUsed", 0);
    if (id) {
      fetchMessages(id, false); // initial load with loading indicator
      connectSSE(id);           // realtime push via SSE (no polling, no fetching)
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

  function addMessage(msg: ChatMessage) {
    // O(1) dedup via Set instead of O(n) array scan
    if (seenUuids.has(msg.uuid)) return;
    seenUuids.add(msg.uuid);

    // Fine-grained append: set at specific index, SolidJS only
    // re-renders the NEW item, not the entire list. No array copy.
    setState("messages", state.messages.length, msg);

    if (msg.model) {
      setState("activeModel", msg.model);
      setState("contextTokensMax", modelContextWindow(msg.model));
    }

    // inputTokens on an assistant response = current context window usage.
    // Replace (not accumulate) — each API call's inputTokens already includes
    // the full conversation context up to that point.
    if (msg.inputTokens && msg.inputTokens > 0) {
      setState("contextTokensUsed", msg.inputTokens);
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
    setHttpApiUrl,
    fetchSessions,
    fetchMessages,
    setActiveSession,
    updateConnectionStatus,
    updateQualityTier,
    updateOrbState,
    upsertSession,
    removeSession,
    addMessage,
    handleEvent,
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

/** Convert a MessageRow (from API or SSE payload) to a ChatMessage for the store. */
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
