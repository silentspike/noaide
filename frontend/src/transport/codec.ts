import { decode as msgpackDecode } from "@msgpack/msgpack";

export type EventSource = "JSONL" | "PTY" | "Proxy" | "Watcher" | "User";
export type QualityTier = "Full" | "Batched" | "Critical";

export interface EventEnvelope {
  eventId: string;
  source: EventSource;
  sequence: number;
  logicalTs: number;
  wallTs: number;
  sessionId?: string;
  dedupKey?: string;
  payload: Uint8Array;
}

const CODEC_MSGPACK = 0x01;

// Pluggable Zstd decompressor — set by WASM module init
let zstdDecompress: ((data: Uint8Array) => Uint8Array) | null = null;

/**
 * Register a Zstd decompression function (called after WASM init).
 * The wasm/compress module provides this via `setDecompressor(wasmDecompress)`.
 */
export function setDecompressor(fn: (data: Uint8Array) => Uint8Array) {
  zstdDecompress = fn;
}

/**
 * Parse a topic-prefixed wire frame from the QUIC stream.
 *
 * Format: [2B topic_len BE][topic][1B codec_id][4B payload_len BE][zstd compressed payload]
 */
export function parseTopicFrame(data: Uint8Array): {
  topic: string;
  envelope: EventEnvelope;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Read topic
  const topicLen = view.getUint16(0);
  const topic = new TextDecoder().decode(data.subarray(2, 2 + topicLen));

  // Read wire frame header
  const frameStart = 2 + topicLen;
  const codecId = data[frameStart];
  const payloadLen = view.getUint32(frameStart + 1);
  const compressed = data.subarray(
    frameStart + 5,
    frameStart + 5 + payloadLen,
  );

  // Decompress with Zstd
  let decompressed: Uint8Array;
  if (zstdDecompress) {
    decompressed = zstdDecompress(compressed);
  } else {
    throw new Error(
      "Zstd decompressor not initialized. Call setDecompressor() after WASM init.",
    );
  }

  // Decode based on codec
  if (codecId === CODEC_MSGPACK) {
    const raw = msgpackDecode(decompressed) as Record<string, unknown>;
    const envelope: EventEnvelope = {
      eventId: raw.event_id as string,
      source: mapSource(raw.source as string),
      sequence: raw.sequence as number,
      logicalTs: raw.logical_ts as number,
      wallTs: raw.wall_ts as number,
      sessionId: raw.session_id as string | undefined,
      dedupKey: raw.dedup_key as string | undefined,
      payload:
        raw.payload instanceof Uint8Array
          ? raw.payload
          : new Uint8Array(raw.payload as ArrayBuffer),
    };
    return { topic, envelope };
  }

  throw new Error(`Unsupported codec: 0x${codecId.toString(16)}`);
}

function mapSource(source: string): EventSource {
  const map: Record<string, EventSource> = {
    Jsonl: "JSONL",
    Pty: "PTY",
    Proxy: "Proxy",
    Watcher: "Watcher",
    User: "User",
  };
  return map[source] ?? "User";
}
