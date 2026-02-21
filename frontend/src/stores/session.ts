import { createStore } from "solid-js/store";
import { createMemo } from "solid-js";
import type { ConnectionStatus } from "../transport/client";
import type { QualityTier, EventEnvelope } from "../transport/codec";

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
}

export function createSessionStore() {
  const [state, setState] = createStore<SessionState>({
    sessions: [],
    activeSessionId: null,
    connectionStatus: "disconnected",
    qualityTier: "Full",
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

  function setActiveSession(id: string | null) {
    setState("activeSessionId", id);
  }

  function updateConnectionStatus(status: ConnectionStatus) {
    setState("connectionStatus", status);
  }

  function updateQualityTier(tier: QualityTier) {
    setState("qualityTier", tier);
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
        // Session discovery and status change events handled here
        break;
    }
  }

  return {
    state,
    activeSession,
    activeSessions,
    sessionCount,
    setActiveSession,
    updateConnectionStatus,
    updateQualityTier,
    upsertSession,
    removeSession,
    handleEvent,
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
