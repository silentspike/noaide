import { describe, it, expect } from "vitest";
import { createSessionStore, type Session } from "./session";
import type { ChatMessage } from "../types/messages";

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    id: "session-1",
    path: "/work/project",
    status: "active",
    startedAt: now,
    lastActivityAt: now,
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

  it("tracks context tokens as last inputTokens value (not cumulative)", () => {
    const store = createSessionStore();
    store.addMessage(makeMessage({ inputTokens: 100 }));
    expect(store.state.contextTokensUsed).toBe(100);
    // Next API call has larger context (conversation grew)
    store.addMessage(makeMessage({ inputTokens: 200 }));
    expect(store.state.contextTokensUsed).toBe(200);
    // After compaction, context drops
    store.addMessage(makeMessage({ inputTokens: 50 }));
    expect(store.state.contextTokensUsed).toBe(50);
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

  it("deduplicates optimistic user messages against parser-delivered ones", () => {
    const store = createSessionStore();

    // Simulate optimistic message from ChatPanel (crypto.randomUUID())
    const optimistic = makeMessage({
      uuid: "optimistic-uuid-1",
      role: "user",
      messageType: "user",
      content: [{ type: "text", text: "Was ist 7+7? Nur die Zahl." }],
    });
    store.addOptimisticUserMessage(optimistic);
    expect(store.state.messages.length).toBe(1);

    // Parser delivers the same message with a different UUID (from Gemini JSON)
    const parsed = makeMessage({
      uuid: "gemini-parsed-uuid-abc",
      role: "user",
      messageType: "user",
      content: [{ type: "text", text: "Was ist 7+7 Nur die Zahl." }], // Gemini strips '?'
    });
    store.addMessage(parsed);

    // Should still be 1 message — the optimistic version stays
    expect(store.state.messages.length).toBe(1);
    expect(store.state.messages[0].uuid).toBe("optimistic-uuid-1");
  });

  it("does not deduplicate non-optimistic user messages", () => {
    const store = createSessionStore();

    // Two different user messages from the parser (no optimistic tracking)
    store.addMessage(makeMessage({ uuid: "u1", role: "user", messageType: "user" }));
    store.addMessage(makeMessage({ uuid: "u2", role: "user", messageType: "user" }));
    expect(store.state.messages.length).toBe(2);
  });

  it("prevents re-adding parsed UUID after optimistic dedup", () => {
    const store = createSessionStore();

    store.addOptimisticUserMessage(
      makeMessage({ uuid: "opt-1", role: "user", messageType: "user" }),
    );
    // Parser delivers with different UUID
    store.addMessage(
      makeMessage({ uuid: "parsed-1", role: "user", messageType: "user" }),
    );
    // Re-parse (e.g., file re-read) tries to add same parsed UUID again
    store.addMessage(
      makeMessage({ uuid: "parsed-1", role: "user", messageType: "user" }),
    );
    expect(store.state.messages.length).toBe(1);
  });
});
