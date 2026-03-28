import { createSignal, onCleanup } from "solid-js";

export interface UseVoiceInputOptions {
  /** WebSocket URL for the whisper transcription proxy */
  wsUrl: string;
  /** Called with progressive partial text as speech is transcribed */
  onPartialText?: (text: string) => void;
  /** Called with the final transcribed text when recording stops */
  onFinalText?: (text: string) => void;
  /** Called on error */
  onError?: (error: string) => void;
}

export interface UseVoiceInputReturn {
  /** Start recording from the microphone */
  startRecording: () => Promise<void>;
  /** Stop recording and get final transcription */
  stopRecording: () => void;
  /** Whether the microphone is actively recording */
  isRecording: () => boolean;
  /** Whether we're connecting to the mic / websocket */
  isConnecting: () => boolean;
  /** Current partial transcription text */
  partialText: () => string;
  /** Last error message */
  error: () => string;
  /** Whether voice input is supported in this browser */
  isSupported: () => boolean;
}

// AudioWorklet module URL — resolved at build time by Vite
const WORKLET_URL = new URL("../workers/pcm-capture.worklet.js", import.meta.url).href;

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputReturn {
  const [isRecording, setIsRecording] = createSignal(false);
  const [isConnecting, setIsConnecting] = createSignal(false);
  const [partialText, setPartialText] = createSignal("");
  const [error, setError] = createSignal("");

  // Check browser support
  const isSupported = () =>
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined";

  // Refs for cleanup
  let ws: WebSocket | null = null;
  let audioCtx: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;

  // PCM chunk counter for logging
  let pcmChunksSent = 0;

  function cleanup() {
    console.log("[voice] cleanup — chunks sent:", pcmChunksSent);
    pcmChunksSent = 0;

    // Stop worklet
    if (workletNode) {
      try {
        workletNode.port.postMessage({ type: "stop" });
      } catch {
        // ignore
      }
      workletNode.disconnect();
      workletNode = null;
    }

    // Disconnect source
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }

    // Stop all media tracks
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
      mediaStream = null;
    }

    // Close AudioContext
    if (audioCtx) {
      console.log("[voice] closing AudioContext (sampleRate was", audioCtx.sampleRate + ")");
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }

    // Close WebSocket
    if (ws) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      ws = null;
    }

    setIsRecording(false);
    setIsConnecting(false);
  }

  async function startRecording() {
    if (isRecording() || isConnecting()) return;

    setError("");
    setPartialText("");
    setIsConnecting(true);

    try {
      // 1. Open WebSocket to whisper proxy
      console.log("[voice] connecting WS to", options.wsUrl);
      const socket = new WebSocket(options.wsUrl);
      ws = socket;

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => {
          console.log("[voice] WS connected");
          resolve();
        };
        socket.onerror = (ev) => {
          console.error("[voice] WS connect error", ev);
          reject(new Error("WebSocket connection failed"));
        };
        // Timeout after 5s
        setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000);
      });

      // 2. Handle incoming messages
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log("[voice] WS msg:", msg.type, msg.text ? `"${msg.text.slice(0, 80)}"` : "");
          if (msg.type === "partial") {
            setPartialText(msg.text || "");
            options.onPartialText?.(msg.text || "");
          } else if (msg.type === "final") {
            const finalText = msg.text || partialText();
            console.log("[voice] final text:", finalText.slice(0, 120));
            setPartialText(finalText);
            options.onFinalText?.(finalText);
            cleanup();
          } else if (msg.type === "silence_detected") {
            console.log("[voice] silence detected — auto-stop");
            cleanup();
          } else if (msg.type === "error") {
            console.error("[voice] server error:", msg.message);
            setError(msg.message || "Transcription error");
            options.onError?.(msg.message || "Transcription error");
            cleanup();
          }
        } catch {
          console.warn("[voice] non-JSON WS message:", typeof event.data, event.data?.length);
        }
      };

      socket.onclose = (ev) => {
        console.log("[voice] WS closed — code:", ev.code, "reason:", ev.reason, "recording:", isRecording());
        if (isRecording()) {
          // Unexpected close — finalize with whatever we have
          const text = partialText();
          if (text) {
            options.onFinalText?.(text);
          }
          cleanup();
        }
      };

      socket.onerror = (ev) => {
        console.error("[voice] WS error (post-connect)", ev);
        setError("WebSocket error");
        options.onError?.("WebSocket error");
        cleanup();
      };

      // 3. Get microphone access
      console.log("[voice] requesting getUserMedia...");
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000, // hint, may not be honored
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const track = mediaStream.getAudioTracks()[0];
      const settings = track?.getSettings();
      console.log("[voice] mic acquired:", track?.label, "rate:", settings?.sampleRate, "channels:", settings?.channelCount);

      // 4. Create AudioContext
      audioCtx = new AudioContext({ sampleRate: 16000 });
      // Some browsers ignore the sampleRate hint — worklet handles resampling
      const actualRate = audioCtx.sampleRate;
      console.log("[voice] AudioContext created — requested 16kHz, got", actualRate + "Hz");

      // 5. Load AudioWorklet module
      console.log("[voice] loading AudioWorklet from", WORKLET_URL);
      await audioCtx.audioWorklet.addModule(WORKLET_URL);
      console.log("[voice] AudioWorklet loaded");

      // 6. Create worklet node
      workletNode = new AudioWorkletNode(audioCtx, "pcm-capture-processor", {
        processorOptions: { sampleRate: actualRate },
      });

      // 7. Worklet → WebSocket: forward PCM chunks
      workletNode.port.onmessage = (event) => {
        if (event.data?.type === "pcm" && socket.readyState === WebSocket.OPEN) {
          const chunk = new Uint8Array(event.data.buffer);
          socket.send(chunk);
          pcmChunksSent++;
          if (pcmChunksSent <= 3 || pcmChunksSent % 50 === 0) {
            console.log("[voice] PCM chunk #" + pcmChunksSent, "size:", chunk.byteLength, "bytes");
          }
        }
      };

      // 8. Connect mic → worklet
      sourceNode = audioCtx.createMediaStreamSource(mediaStream);
      sourceNode.connect(workletNode);
      // Don't connect worklet to destination (we don't want playback)

      setIsConnecting(false);
      setIsRecording(true);
      console.log("[voice] recording started");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[voice] startRecording error:", msg, err);
      setError(msg);
      options.onError?.(msg);
      cleanup();
    }
  }

  function stopRecording() {
    if (!isRecording() && !isConnecting()) return;
    console.log("[voice] stopRecording — sending stop to server");

    // Tell server we're stopping
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
      // Wait briefly for final response, then cleanup
      setTimeout(() => {
        if (isRecording()) {
          console.warn("[voice] server didn't respond to stop in 2s — using partial as final");
          const text = partialText();
          if (text) {
            options.onFinalText?.(text);
          }
          cleanup();
        }
      }, 2000);
    } else {
      console.log("[voice] WS not open — cleaning up directly");
      cleanup();
    }
  }

  // Auto-cleanup on component unmount
  onCleanup(cleanup);

  return {
    startRecording,
    stopRecording,
    isRecording,
    isConnecting,
    partialText,
    error,
    isSupported,
  };
}
