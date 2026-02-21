import { createStore } from "solid-js/store";
import { createMemo } from "solid-js";
import type { ConnectionStatus } from "../transport/client";
import type { QualityTier, EventEnvelope } from "../transport/codec";
import type { ChatMessage, OrbState } from "../types/messages";

export interface Session {
  id: string;
  path: string;
  status: "active" | "idle" | "archived" | "error";
  model?: string;
  startedAt: number;
  messageCount: number;
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

  function setActiveSession(id: string | null) {
    setState("activeSessionId", id);
    if (id !== state.activeSessionId) {
      setState("messages", []);
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
      case "session/messages":
        if (envelope.sessionId) {
          const sid = envelope.sessionId;
          setState(
            "sessions",
            (s) => s.id === sid,
            "messageCount",
            (c) => c + 1,
          );
        }
        break;
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
