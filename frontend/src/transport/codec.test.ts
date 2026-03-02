import { describe, it, expect, beforeEach } from "vitest";
import { encode as msgpackEncode } from "@msgpack/msgpack";
import { parseTopicFrame, setDecompressor } from "./codec";

/**
 * Build a topic-prefixed wire frame matching the server format:
 * [2B topic_len BE][topic][1B codec_id][4B payload_len BE][compressed payload]
 */
function buildFrame(topic: string, payload: Uint8Array): Uint8Array {
  const topicBytes = new TextEncoder().encode(topic);
  const codecId = 0x01; // MessagePack

  // Frame: 2B topic_len + topic + 1B codec + 4B payload_len + payload
  const frame = new Uint8Array(
    2 + topicBytes.length + 1 + 4 + payload.length,
  );
  const view = new DataView(frame.buffer);

  view.setUint16(0, topicBytes.length);
  frame.set(topicBytes, 2);
  frame[2 + topicBytes.length] = codecId;
  view.setUint32(2 + topicBytes.length + 1, payload.length);
  frame.set(payload, 2 + topicBytes.length + 5);

  return frame;
}

describe("codec", () => {
  beforeEach(() => {
    // Register identity decompressor (no real Zstd in unit tests)
    setDecompressor((data: Uint8Array) => data);
  });

  it("parseTopicFrame decodes a valid MessagePack frame", () => {
    const envelope = {
      event_id: "abc-123",
      source: "Jsonl",
      sequence: 42,
      logical_ts: 100,
      wall_ts: 1700000000,
      session_id: "sess-1",
      dedup_key: null,
      payload: new Uint8Array([1, 2, 3]),
    };
    const encoded = msgpackEncode(envelope);
    const frame = buildFrame("session.messages", new Uint8Array(encoded));

    const result = parseTopicFrame(frame);

    expect(result.topic).toBe("session.messages");
    expect(result.envelope.eventId).toBe("abc-123");
    expect(result.envelope.source).toBe("JSONL");
    expect(result.envelope.sequence).toBe(42);
    expect(result.envelope.logicalTs).toBe(100);
    expect(result.envelope.wallTs).toBe(1700000000);
    expect(result.envelope.sessionId).toBe("sess-1");
    expect(result.envelope.payload).toBeInstanceOf(Uint8Array);
  });

  it("parseTopicFrame maps all source types correctly", () => {
    const sources: Array<[string, string]> = [
      ["Jsonl", "JSONL"],
      ["Pty", "PTY"],
      ["Proxy", "Proxy"],
      ["Watcher", "Watcher"],
      ["User", "User"],
      ["Unknown", "User"], // fallback
    ];

    for (const [wire, expected] of sources) {
      const envelope = {
        event_id: "id",
        source: wire,
        sequence: 0,
        logical_ts: 0,
        wall_ts: 0,
        payload: new Uint8Array(),
      };
      const encoded = msgpackEncode(envelope);
      const frame = buildFrame("test.topic", new Uint8Array(encoded));

      const result = parseTopicFrame(frame);
      expect(result.envelope.source).toBe(expected);
    }
  });

  it("parseTopicFrame throws on unsupported codec", () => {
    const topicBytes = new TextEncoder().encode("test");
    const frame = new Uint8Array(2 + topicBytes.length + 1 + 4 + 1);
    const view = new DataView(frame.buffer);
    view.setUint16(0, topicBytes.length);
    frame.set(topicBytes, 2);
    frame[2 + topicBytes.length] = 0xff; // unsupported codec
    view.setUint32(2 + topicBytes.length + 1, 1);
    frame[2 + topicBytes.length + 5] = 0x00;

    expect(() => parseTopicFrame(frame)).toThrow("Unsupported codec");
  });

  it("parseTopicFrame throws without decompressor", () => {
    // Reset decompressor to null to test the error path
    setDecompressor(null as unknown as (data: Uint8Array) => Uint8Array);

    const envelope = {
      event_id: "x",
      source: "User",
      sequence: 0,
      logical_ts: 0,
      wall_ts: 0,
      payload: new Uint8Array(),
    };
    const encoded = msgpackEncode(envelope);
    const frame = buildFrame("t", new Uint8Array(encoded));

    expect(() => parseTopicFrame(frame)).toThrow(
      "Zstd decompressor not initialized",
    );
  });

  it("setDecompressor registers a custom decompression function", () => {
    let called = false;
    setDecompressor((data: Uint8Array) => {
      called = true;
      return data;
    });

    const envelope = {
      event_id: "id",
      source: "User",
      sequence: 0,
      logical_ts: 0,
      wall_ts: 0,
      payload: new Uint8Array(),
    };
    const encoded = msgpackEncode(envelope);
    const frame = buildFrame("test", new Uint8Array(encoded));

    parseTopicFrame(frame);
    expect(called).toBe(true);
  });
});
