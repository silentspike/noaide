import { describe, it, expect } from "vitest";
import { parseRequestBody, parseResponseBody } from "./InterceptQueue";

describe("parseRequestBody", () => {
  it("parses Anthropic request body", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: "You are a helpful assistant.",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ],
    });
    const result = parseRequestBody(body);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-sonnet-4-20250514");
    expect(result!.maxTokens).toBe(8192);
    expect(result!.system).toBe("You are a helpful assistant.");
    expect(result!.messages).toHaveLength(2);
    expect(result!.messages[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("handles array system prompt", () => {
    const body = JSON.stringify({
      model: "gpt-4",
      system: [{ text: "Part 1" }, { text: "Part 2" }],
      messages: [],
    });
    const result = parseRequestBody(body);
    expect(result).not.toBeNull();
    expect(result!.system).toBe("Part 1\nPart 2");
  });

  it("handles content blocks in messages", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this:" },
            { type: "image" },
          ],
        },
      ],
    });
    const result = parseRequestBody(body);
    expect(result).not.toBeNull();
    expect(result!.messages[0].content).toBe("Look at this:\n[image]");
  });

  it("returns null for invalid JSON", () => {
    expect(parseRequestBody("not json")).toBeNull();
  });

  it("handles empty body", () => {
    expect(parseRequestBody("{}")).not.toBeNull();
    expect(parseRequestBody("{}")).toEqual({
      model: "",
      maxTokens: 0,
      system: "",
      messages: [],
    });
  });
});

describe("parseResponseBody", () => {
  it("parses Anthropic response body", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      type: "message",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Hello world" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const result = parseResponseBody(body);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-sonnet-4-20250514");
    expect(result!.type).toBe("message");
    expect(result!.stopReason).toBe("end_turn");
    expect(result!.content).toBe("Hello world");
    expect(result!.inputTokens).toBe(100);
    expect(result!.outputTokens).toBe(50);
  });

  it("handles multiple content blocks", () => {
    const body = JSON.stringify({
      content: [
        { type: "thinking", text: "Let me think..." },
        { type: "text", text: "Here is my answer" },
      ],
      usage: {},
    });
    const result = parseResponseBody(body);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("Let me think...\nHere is my answer");
  });

  it("handles content blocks without text", () => {
    const body = JSON.stringify({
      content: [{ type: "tool_use" }],
      usage: {},
    });
    const result = parseResponseBody(body);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("[tool_use]");
  });

  it("returns null for invalid JSON", () => {
    expect(parseResponseBody("not json")).toBeNull();
  });

  it("handles missing fields gracefully", () => {
    const result = parseResponseBody("{}");
    expect(result).not.toBeNull();
    expect(result!.model).toBe("");
    expect(result!.stopReason).toBe("");
    expect(result!.inputTokens).toBe(0);
  });
});
