import { createSignal, Show, onCleanup } from "solid-js";

// Web Speech API types (not in all TS libs)
interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

interface VoiceInputProps {
  onTranscript: (text: string) => void;
}

export default function VoiceInput(props: VoiceInputProps) {
  const [isRecording, setIsRecording] = createSignal(false);
  const [isSupported] = createSignal(
    typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window),
  );

  let recognition: SpeechRecognition | null = null;

  const startRecording = () => {
    if (!isSupported()) return;

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      props.onTranscript(transcript);
      setIsRecording(false);
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    recognition?.stop();
    setIsRecording(false);
  };

  onCleanup(() => {
    recognition?.abort();
  });

  return (
    <Show when={isSupported()}>
      <button
        onClick={() => (isRecording() ? stopRecording() : startRecording())}
        style={{
          position: "fixed",
          bottom: "80px",
          right: "16px",
          width: "48px",
          height: "48px",
          "border-radius": "50%",
          background: isRecording() ? "var(--ctp-red)" : "var(--ctp-blue)",
          border: "none",
          color: "var(--ctp-base)",
          cursor: "pointer",
          "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": "50",
          animation: isRecording() ? "pulse-mic 1s ease-in-out infinite" : "none",
          "-webkit-tap-highlight-color": "transparent",
        }}
        aria-label={isRecording() ? "Stop recording" : "Start voice input"}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          {isRecording() ? (
            <rect x="6" y="6" width="12" height="12" rx="2" />
          ) : (
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zm-1 18.93A8 8 0 015 12h2a6 6 0 0010 0h2a8 8 0 01-6 7.93V22h-2v-2.07z" />
          )}
        </svg>
      </button>
    </Show>
  );
}
