import { parseTopicFrame, type EventEnvelope, type QualityTier } from "./codec";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface TransportClientOptions {
  url: string;
  certHashUrl?: string;
  onEvent?: (topic: string, envelope: EventEnvelope) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onTierChange?: (tier: QualityTier) => void;
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 500;

/** Decode a base64 string to an ArrayBuffer. */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export class TransportClient {
  private transport: WebTransport | null = null;
  private url: string;
  private certHashUrl: string;
  private status: ConnectionStatus = "disconnected";
  private tier: QualityTier = "Full";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  private onEvent?: (topic: string, envelope: EventEnvelope) => void;
  private onStatusChange?: (status: ConnectionStatus) => void;
  private onTierChange?: (tier: QualityTier) => void;

  constructor(options: TransportClientOptions) {
    this.url = options.url;
    this.certHashUrl =
      options.certHashUrl ??
      `http://${window.location.hostname}:8080/api/cert-hash`;
    this.onEvent = options.onEvent;
    this.onStatusChange = options.onStatusChange;
    this.onTierChange = options.onTierChange;
  }

  async connect(): Promise<void> {
    if (this.status === "connecting" || this.status === "connected") return;

    this.abortController = new AbortController();
    this.setStatus("connecting");

    try {
      // Fetch certificate hash from server HTTP API for self-signed cert trust
      const certHash = await this.fetchCertHash();

      const options: WebTransportOptions = {};
      if (certHash) {
        options.serverCertificateHashes = [
          {
            algorithm: "sha-256",
            value: base64ToArrayBuffer(certHash),
          },
        ];
      }

      this.transport = new WebTransport(this.url, options);
      await this.transport.ready;

      this.setStatus("connected");
      this.reconnectAttempt = 0;

      this.readStreams();

      this.transport.closed
        .then(() => {
          this.setStatus("disconnected");
          this.scheduleReconnect();
        })
        .catch(() => {
          this.setStatus("disconnected");
          this.scheduleReconnect();
        });
    } catch (e) {
      console.warn("[transport] connection failed:", e);
      this.setStatus("disconnected");
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.abortController?.abort();
    this.abortController = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.transport?.close();
    this.transport = null;
    this.setStatus("disconnected");
    this.reconnectAttempt = 0;
  }

  isConnected(): boolean {
    return this.status === "connected";
  }

  currentStatus(): ConnectionStatus {
    return this.status;
  }

  currentTier(): QualityTier {
    return this.tier;
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.onStatusChange?.(status);
  }

  private async fetchCertHash(): Promise<string | null> {
    try {
      const resp = await fetch(this.certHashUrl);
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        algorithm: string;
        hash: string;
      };
      console.info(
        `[transport] cert hash: ${data.algorithm} ${data.hash.substring(0, 12)}...`,
      );
      return data.hash;
    } catch (e) {
      console.warn("[transport] failed to fetch cert hash:", e);
      return null;
    }
  }

  private scheduleReconnect() {
    if (this.abortController?.signal.aborted) return;

    const backoff = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, this.reconnectAttempt),
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempt++;

    console.warn(
      `[transport] reconnecting in ${backoff}ms (attempt ${this.reconnectAttempt})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, backoff);
  }

  private async readStreams() {
    if (!this.transport) return;

    const reader = this.transport.incomingUnidirectionalStreams.getReader();
    try {
      while (true) {
        const { done, value: stream } = await reader.read();
        if (done) break;
        this.readStream(stream);
      }
    } catch (e) {
      if (!this.abortController?.signal.aborted) {
        console.warn("[transport] stream reader error:", e);
      }
    }
  }

  private async readStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    let buffer = new Uint8Array(0);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append to buffer
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;

        // Parse complete frames from buffer
        while (buffer.length >= 2) {
          const view = new DataView(
            buffer.buffer,
            buffer.byteOffset,
            buffer.byteLength,
          );
          const topicLen = view.getUint16(0);

          // Minimum frame: 2 (topic_len) + topicLen + 1 (codec) + 4 (payload_len)
          const headerSize = 2 + topicLen + 5;
          if (buffer.length < headerSize) break;

          const payloadLen = view.getUint32(2 + topicLen + 1);
          const totalSize = headerSize + payloadLen;

          if (buffer.length < totalSize) break;

          // Extract and decode complete frame
          const frame = buffer.slice(0, totalSize);
          buffer = buffer.subarray(totalSize);

          try {
            const { topic, envelope } = parseTopicFrame(frame);
            this.onEvent?.(topic, envelope);
          } catch (e) {
            console.warn("[transport] frame decode error:", e);
          }
        }
      }
    } catch (e) {
      if (!this.abortController?.signal.aborted) {
        console.warn("[transport] stream read error:", e);
      }
    }
  }
}
