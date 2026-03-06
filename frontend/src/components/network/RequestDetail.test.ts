import { describe, it, expect } from "vitest";
import {
  tryParseJson,
  parseSseEvents,
  extractResponseContent,
} from "./RequestDetail";

describe("tryParseJson", () => {
  it("parses valid JSON", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null for invalid JSON", () => {
    expect(tryParseJson("not json")).toBeNull();
  });

  it("parses arrays", () => {
    expect(tryParseJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("returns null for empty string", () => {
    expect(tryParseJson("")).toBeNull();
  });
});

describe("parseSseEvents", () => {
  it("parses single event", () => {
    const sse = "event: message_start\ndata: {\"type\":\"message_start\"}\n\n";
    const events = parseSseEvents(sse);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message_start");
    expect(events[0].data).toEqual({ type: "message_start" });
  });

  it("parses multiple events", () => {
    const sse = [
      "event: message_start",
      'data: {"type":"message_start"}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
      "",
    ].join("\n");
    const events = parseSseEvents(sse);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("message_start");
    expect(events[1].event).toBe("content_block_delta");
  });

  it("handles non-JSON data", () => {
    const sse = "event: ping\ndata: keep-alive\n\n";
    const events = parseSseEvents(sse);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("keep-alive");
  });

  it("handles leftover data without trailing blank line", () => {
    const sse = "event: done\ndata: {\"fin\":true}";
    const events = parseSseEvents(sse);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("done");
    expect(events[0].data).toEqual({ fin: true });
  });

  it("defaults event name to 'data'", () => {
    const sse = 'data: {"msg":"hi"}\n\n';
    const events = parseSseEvents(sse);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("data");
  });
});

describe("extractResponseContent", () => {
  it("extracts model and text from SSE stream", () => {
    const sse = [
      "event: message_start",
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4-20250514","usage":{"input_tokens":100}}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50}}',
      "",
    ].join("\n");

    const result = extractResponseContent(sse);
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.text).toBe("Hello world");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.stopReason).toBe("end_turn");
  });

  it("extracts thinking blocks", () => {
    const sse = [
      "event: message_start",
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4-20250514","usage":{"input_tokens":10}}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Let me think..."}}',
      "",
    ].join("\n");

    const result = extractResponseContent(sse);
    expect(result.thinking).toBe("Let me think...");
  });

  it("handles empty SSE", () => {
    const result = extractResponseContent("");
    expect(result.model).toBe("");
    expect(result.text).toBe("");
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });
});
