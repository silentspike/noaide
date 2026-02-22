import { createStore } from "solid-js/store";
import { createMemo, batch } from "solid-js";
import type { ConnectionStatus } from "../transport/client";
import type { QualityTier, EventEnvelope } from "../transport/codec";
import type { ChatMessage, OrbState, ContentBlock } from "../types/messages";

export interface Session {
  id: string;
  path: string;
  status: "active" | "idle" | "archived" | "error";
  model?: string;
  startedAt: number;
  messageCount: number;
  cost?: number;
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
  });

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
        cost: number | null;
        messageCount: number;
      }> = await resp.json();

      // Batch-update all sessions in one reactive flush
      const sessions: Session[] = data.map((s) => ({
        id: s.id,
        path: s.path,
        status: mapStatus(s.status),
        model: s.model ?? undefined,
        startedAt: s.startedAt * 1000,
        messageCount: s.messageCount,
        cost: s.cost ?? undefined,
      }));
      batch(() => {
        setState("sessions", sessions);
      });
    } catch (e) {
      console.warn("[session] fetchSessions failed:", e);
    }
  }

  async function fetchMessages(sessionId: string) {
    const base = state.httpApiUrl;
    if (!base) return;

    try {
      const resp = await fetch(`${base}/api/sessions/${sessionId}/messages`);
      if (!resp.ok) return;
      const data: Array<{
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
      }> = await resp.json();

      // Batch-convert all messages (no reactive updates during loop)
      const messages: ChatMessage[] = [];
      let totalTokenCount = 0;
      let lastModel: string | undefined;

      for (const m of data) {
        // Use structured contentBlocks from API if available, else fallback
        const contentBlocks = m.contentBlocks && m.contentBlocks.length > 0
          ? m.contentBlocks
          : parseContentToBlocks(m.content, m.messageType);

        const msg: ChatMessage = {
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
        messages.push(msg);

        const msgTokens = (m.inputTokens ?? 0) + (m.outputTokens ?? 0)
          + (m.cacheCreationInputTokens ?? 0) + (m.cacheReadInputTokens ?? 0);
        totalTokenCount += msgTokens || (m.tokens ?? 0);

        if (m.model) lastModel = m.model;
      }

      // Single batch update — one reactive flush for all messages
      batch(() => {
        setState("messages", messages);
        setState("contextTokensUsed", totalTokenCount);
        if (lastModel) setState("activeModel", lastModel);
      });
    } catch (e) {
      console.warn("[session] fetchMessages failed:", e);
    }
  }

  function setActiveSession(id: string | null) {
    if (id === state.activeSessionId) return;
    setState("activeSessionId", id);
    setState("messages", []);
    setState("contextTokensUsed", 0);
    if (id) {
      fetchMessages(id);
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

  function addMessage(msg: ChatMessage) {
    setState("messages", (msgs) => {
      if (msgs.some((m) => m.uuid === msg.uuid)) return msgs;
      return [...msgs, msg];
    });

    if (msg.model) {
      setState("activeModel", msg.model);
    }

    const tokens =
      (msg.inputTokens ?? 0) +
      (msg.outputTokens ?? 0) +
      (msg.cacheCreationInputTokens ?? 0) +
      (msg.cacheReadInputTokens ?? 0);
    if (tokens > 0) {
      setState("contextTokensUsed", (prev) => prev + tokens);
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
          // Update message count for the session
          setState(
            "sessions",
            (s) => s.id === sid,
            "messageCount",
            (c) => c + 1,
          );
          // If this session is currently selected, fetch new messages
          if (state.activeSessionId === sid) {
            fetchMessages(sid);
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

function mapRole(r: string): "user" | "assistant" | "system" {
  switch (r) {
    case "user": return "user";
    case "assistant": return "assistant";
    case "system": return "system";
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
      return [{ type: "text", text: content }];
    case "ToolResult":
      return [{ type: "text", text: content }];
    case "SystemReminder":
      return [{ type: "text", text: content }];
    default:
      return [{ type: "text", text: content }];
  }
}
