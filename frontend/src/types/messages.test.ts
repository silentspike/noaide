import { describe, it, expect } from "vitest";
import {
  totalTokens,
  hasThinking,
  hasToolUse,
  hasToolResult,
  textContent,
  type ChatMessage,
  type ContentBlock,
} from "./messages";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    uuid: "test-uuid",
    role: "assistant",
    messageType: "assistant",
    content: [],
    ...overrides,
  };
}

function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

function thinkingBlock(thinking: string): ContentBlock {
  return { type: "thinking", thinking };
}

function toolUseBlock(name: string): ContentBlock {
  return { type: "tool_use", id: "tu-1", name, input: {} };
}

function toolResultBlock(toolUseId: string, content: string, isError = false): ContentBlock {
  return { type: "tool_result", tool_use_id: toolUseId, content, is_error: isError };
}

describe("totalTokens", () => {
  it("returns 0 for message without token fields", () => {
    expect(totalTokens(makeMessage())).toBe(0);
  });

  it("sums all token fields", () => {
    const msg = makeMessage({
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 30,
    });
    expect(totalTokens(msg)).toBe(380);
  });

  it("handles partial token fields", () => {
    const msg = makeMessage({ inputTokens: 100, outputTokens: 200 });
    expect(totalTokens(msg)).toBe(300);
  });
});

describe("hasThinking", () => {
  it("returns false for empty content", () => {
    expect(hasThinking(makeMessage())).toBe(false);
  });

  it("returns false for text-only content", () => {
    expect(hasThinking(makeMessage({ content: [textBlock("hello")] }))).toBe(false);
  });

  it("returns true when thinking block present", () => {
    expect(
      hasThinking(makeMessage({ content: [textBlock("hello"), thinkingBlock("reasoning")] })),
    ).toBe(true);
  });
});

describe("hasToolUse", () => {
  it("returns false for text-only content", () => {
    expect(hasToolUse(makeMessage({ content: [textBlock("hello")] }))).toBe(false);
  });

  it("returns true when tool_use block present", () => {
    expect(hasToolUse(makeMessage({ content: [toolUseBlock("Read")] }))).toBe(true);
  });
});

describe("hasToolResult", () => {
  it("returns false for text-only content", () => {
    expect(hasToolResult(makeMessage({ content: [textBlock("hello")] }))).toBe(false);
  });

  it("returns true when tool_result block present", () => {
    expect(
      hasToolResult(makeMessage({ content: [toolResultBlock("tu-1", "output")] })),
    ).toBe(true);
  });

  it("detects error tool results", () => {
    const msg = makeMessage({ content: [toolResultBlock("tu-1", "error msg", true)] });
    expect(hasToolResult(msg)).toBe(true);
    expect(msg.content[0].is_error).toBe(true);
  });
});

describe("textContent", () => {
  it("returns empty string for no content blocks", () => {
    expect(textContent(makeMessage())).toBe("");
  });

  it("extracts text from text blocks", () => {
    const msg = makeMessage({
      content: [textBlock("hello"), textBlock("world")],
    });
    expect(textContent(msg)).toBe("hello\nworld");
  });

  it("ignores non-text blocks", () => {
    const msg = makeMessage({
      content: [textBlock("visible"), thinkingBlock("hidden"), toolUseBlock("Read")],
    });
    expect(textContent(msg)).toBe("visible");
  });

  it("handles blocks with undefined text", () => {
    const msg = makeMessage({
      content: [{ type: "text" as const }],
    });
    expect(textContent(msg)).toBe("");
  });
});
