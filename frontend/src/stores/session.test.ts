import { describe, it, expect } from "vitest";
import { createSessionStore, type Session } from "./session";
import type { ChatMessage } from "../types/messages";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    path: "/work/project",
    status: "active",
    startedAt: Date.now(),
    messageCount: 0,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    uuid: `msg-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    messageType: "assistant",
    content: [{ type: "text", text: "hello" }],
    ...overrides,
  };
}

describe("createSessionStore", () => {
  it("initializes with empty state", () => {
    const store = createSessionStore();
    expect(store.state.sessions).toEqual([]);
    expect(store.state.activeSessionId).toBeNull();
    expect(store.state.connectionStatus).toBe("disconnected");
    expect(store.state.orbState).toBe("idle");
    expect(store.sessionCount()).toBe(0);
  });

  it("upserts a session", () => {
    const store = createSessionStore();
    const session = makeSession();
    store.upsertSession(session);
    expect(store.state.sessions.length).toBe(1);
    expect(store.state.sessions[0].id).toBe("session-1");
  });

  it("updates existing session on upsert", () => {
    const store = createSessionStore();
    store.upsertSession(makeSession({ messageCount: 0 }));
    store.upsertSession(makeSession({ messageCount: 5 }));
    expect(store.state.sessions.length).toBe(1);
    expect(store.state.sessions[0].messageCount).toBe(5);
  });

  it("removes a session", () => {
    const store = createSessionStore();
    store.upsertSession(makeSession({ id: "s1" }));
    store.upsertSession(makeSession({ id: "s2" }));
    expect(store.state.sessions.length).toBe(2);
    store.removeSession("s1");
    expect(store.state.sessions.length).toBe(1);
    expect(store.state.sessions[0].id).toBe("s2");
  });

  it("clears activeSessionId when removing active session", () => {
    const store = createSessionStore();
    store.upsertSession(makeSession({ id: "s1" }));
    store.setActiveSession("s1");
    expect(store.state.activeSessionId).toBe("s1");
    store.removeSession("s1");
    expect(store.state.activeSessionId).toBeNull();
  });

  it("tracks active session via memo", () => {
    const store = createSessionStore();
    store.upsertSession(makeSession({ id: "s1", path: "/work/a" }));
    store.upsertSession(makeSession({ id: "s2", path: "/work/b" }));
    expect(store.activeSession()).toBeNull();
    store.setActiveSession("s1");
    expect(store.activeSession()?.path).toBe("/work/a");
  });

  it("filters active sessions", () => {
    const store = createSessionStore();
    store.upsertSession(makeSession({ id: "s1", status: "active" }));
    store.upsertSession(makeSession({ id: "s2", status: "archived" }));
    store.upsertSession(makeSession({ id: "s3", status: "idle" }));
    expect(store.activeSessions().length).toBe(2);
  });

  it("adds messages with deduplication", () => {
    const store = createSessionStore();
    store.setActiveSession("s1");
    const msg = makeMessage({ uuid: "msg-1" });
    store.addMessage(msg);
    store.addMessage(msg); // duplicate
    expect(store.state.messages.length).toBe(1);
  });

  it("updates orb state based on message content", () => {
    const store = createSessionStore();

    // Thinking block
    store.addMessage(
      makeMessage({ content: [{ type: "thinking", thinking: "hmm" }] }),
    );
    expect(store.state.orbState).toBe("thinking");

    // Tool use
    store.addMessage(
      makeMessage({ content: [{ type: "tool_use", id: "t1", name: "Read" }] }),
    );
    expect(store.state.orbState).toBe("tool_use");

    // End turn
    store.addMessage(makeMessage({ stopReason: "end_turn" }));
    expect(store.state.orbState).toBe("idle");
  });

  it("sets error state on error tool results", () => {
    const store = createSessionStore();
    store.addMessage(
      makeMessage({
        content: [{ type: "tool_result", tool_use_id: "t1", content: "error", is_error: true }],
      }),
    );
    expect(store.state.orbState).toBe("error");
  });

  it("tracks model from messages", () => {
    const store = createSessionStore();
    expect(store.state.activeModel).toBeNull();
    store.addMessage(makeMessage({ model: "claude-opus-4-6" }));
    expect(store.state.activeModel).toBe("claude-opus-4-6");
  });

  it("accumulates context tokens", () => {
    const store = createSessionStore();
    store.addMessage(makeMessage({ inputTokens: 100, outputTokens: 50 }));
    expect(store.state.contextTokensUsed).toBe(150);
    store.addMessage(makeMessage({ inputTokens: 200 }));
    expect(store.state.contextTokensUsed).toBe(350);
  });

  it("calculates total session cost", () => {
    const store = createSessionStore();
    store.addMessage(makeMessage({ costUsd: 0.01 }));
    store.addMessage(makeMessage({ costUsd: 0.02 }));
    expect(store.totalSessionCost()).toBeCloseTo(0.03);
  });

  it("updates connection status", () => {
    const store = createSessionStore();
    store.updateConnectionStatus("connected");
    expect(store.state.connectionStatus).toBe("connected");
  });

  it("updates quality tier", () => {
    const store = createSessionStore();
    store.updateQualityTier("Batched");
    expect(store.state.qualityTier).toBe("Batched");
  });
});
