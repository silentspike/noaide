import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import type { ImageSource } from "../../types/messages";
import { useVoiceInput } from "../../hooks/useVoiceInput";

interface PendingImage {
  id: string;
  dataUrl: string;
  mediaType: string;
  size: number;
}

interface InputFieldProps {
  disabled: boolean;
  onSubmit: (content: { text: string; images: ImageSource[] }) => void;
  /** WebSocket URL for whisper transcription. If set, mic button is shown. */
  whisperUrl?: string;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export default function InputField(props: InputFieldProps) {
  const [text, setText] = createSignal("");
  const [pendingImages, setPendingImages] = createSignal<PendingImage[]>([]);
  const [dragOver, setDragOver] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  // Text typed/present before recording started — used to preserve user input
  let textBeforeRecording = "";

  // Voice input hook — only active when whisperUrl is provided
  const voice = useVoiceInput({
    get wsUrl() {
      return props.whisperUrl || "";
    },
    onPartialText: (partial) => {
      // Write partial text live into textarea (after any pre-existing text)
      const prefix = textBeforeRecording;
      const separator = prefix && !prefix.endsWith(" ") ? " " : "";
      setText(prefix + separator + partial);
      if (textareaRef) {
        textareaRef.style.height = "auto";
        textareaRef.style.height = Math.min(textareaRef.scrollHeight, 200) + "px";
      }
    },
    onFinalText: (final) => {
      console.log("[input] voice finalText:", final.slice(0, 120));
      // Replace partial with final text
      const prefix = textBeforeRecording;
      const separator = prefix && !prefix.endsWith(" ") ? " " : "";
      setText(prefix + separator + final);
      if (textareaRef) {
        textareaRef.style.height = "auto";
        textareaRef.style.height = Math.min(textareaRef.scrollHeight, 200) + "px";
      }
    },
  });

  function toggleMic() {
    console.log("[input] toggleMic — recording:", voice.isRecording(), "connecting:", voice.isConnecting(), "url:", props.whisperUrl);
    if (voice.isRecording()) {
      voice.stopRecording();
    } else {
      // Save current text so partial/final text gets appended after it
      textBeforeRecording = text();
      voice.startRecording();
    }
  }

  function openFilePicker() {
    fileInputRef?.click();
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      addImageFile(files[i]);
    }
    // Reset so same file can be selected again
    input.value = "";
  }

  function addImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_SIZE) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPendingImages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          dataUrl: reader.result as string,
          mediaType: file.type,
          size: file.size,
        },
      ]);
    };
    reader.readAsDataURL(file);
  }

  function removeImage(id: string) {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  }

  function handlePaste(e: ClipboardEvent) {
    if (props.disabled) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFile(file);
        // Focus the textarea so user can immediately type a message
        textareaRef?.focus();
      }
    }
  }

  // Global paste listener — catches Ctrl+V from anywhere in the page,
  // not just when textarea has focus. Essential UX: users expect paste
  // to work regardless of where they clicked.
  onMount(() => document.addEventListener("paste", handlePaste as EventListener));
  onCleanup(() => document.removeEventListener("paste", handlePaste as EventListener));

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      addImageFile(files[i]);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const t = text().trim();
    const imgs = pendingImages();
    if ((!t && imgs.length === 0) || props.disabled) return;

    const images: ImageSource[] = imgs.map((img) => ({
      type: "base64",
      media_type: img.mediaType,
      data: img.dataUrl.split(",")[1] || "",
    }));

    props.onSubmit({ text: t, images });
    setText("");
    setPendingImages([]);
    if (textareaRef) {
      textareaRef.style.height = "auto";
    }
  }

  function handleInput(e: InputEvent) {
    const target = e.target as HTMLTextAreaElement;
    setText(target.value);
    target.style.height = "auto";
    target.style.height = Math.min(target.scrollHeight, 200) + "px";
  }

  const hasContent = () => text().trim() !== "" || pendingImages().length > 0;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: "relative",
        display: "flex",
        "flex-direction": "column",
        gap: "0",
        padding: "0",
        "border-top": dragOver()
          ? "2px solid var(--neon-blue, #00b8ff)"
          : "1px solid var(--ctp-surface1)",
        background: "rgba(14,14,24,0.88)",
        "backdrop-filter": "blur(16px)",
        "-webkit-backdrop-filter": "blur(16px)",
        transition: "border-color 150ms ease",
      }}
    >
      {/* Image preview strip */}
      <Show when={pendingImages().length > 0}>
        <div
          style={{
            display: "flex",
            gap: "6px",
            padding: "8px 16px 0",
            "flex-wrap": "wrap",
          }}
        >
          <For each={pendingImages()}>
            {(img) => (
              <div
                style={{
                  position: "relative",
                  width: "48px",
                  height: "48px",
                  "border-radius": "4px",
                  overflow: "hidden",
                  border: "1px solid var(--ctp-surface2)",
                  "flex-shrink": "0",
                }}
              >
                <img
                  src={img.dataUrl}
                  alt="Preview"
                  style={{
                    width: "100%",
                    height: "100%",
                    "object-fit": "cover",
                  }}
                />
                <button
                  onClick={() => removeImage(img.id)}
                  style={{
                    position: "absolute",
                    top: "-1px",
                    right: "-1px",
                    width: "16px",
                    height: "16px",
                    background: "var(--ctp-red, #f38ba8)",
                    color: "var(--ctp-base)",
                    border: "none",
                    "border-radius": "0 4px 0 4px",
                    "font-size": "10px",
                    "line-height": "1",
                    cursor: "pointer",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    padding: "0",
                  }}
                >
                  X
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Hidden file input for mobile camera/gallery */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      {/* Input row */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          padding: "12px 16px",
          "align-items": "flex-end",
        }}
      >
        {/* + Button for image picker (camera/gallery on mobile) */}
        <button
          data-testid="chat-add-image"
          onClick={openFilePicker}
          disabled={props.disabled}
          title="Add image"
          style={{
            width: "36px",
            height: "36px",
            "min-width": "36px",
            background: props.disabled
              ? "var(--ctp-surface0)"
              : "var(--ctp-surface1)",
            color: props.disabled
              ? "var(--ctp-overlay0)"
              : "var(--ctp-text)",
            border: "1px solid var(--ctp-surface2)",
            "border-radius": "6px",
            cursor: props.disabled ? "not-allowed" : "pointer",
            "font-size": "18px",
            "font-weight": "700",
            "line-height": "1",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            padding: "0",
            "flex-shrink": "0",
            transition: "all 200ms ease",
          }}
        >
          +
        </button>

        {/* Mic button — only shown when whisper is available */}
        <Show when={props.whisperUrl && voice.isSupported()}>
          <button
            data-testid="chat-mic"
            onClick={toggleMic}
            disabled={props.disabled || voice.isConnecting()}
            title={
              voice.isRecording()
                ? "Stop recording"
                : voice.isConnecting()
                  ? "Connecting..."
                  : "Voice input"
            }
            class={voice.isRecording() ? "mic-pulse" : ""}
            style={{
              width: "36px",
              height: "36px",
              "min-width": "36px",
              background: voice.isRecording()
                ? "var(--ctp-red)"
                : voice.isConnecting()
                  ? "var(--ctp-yellow)"
                  : props.disabled
                    ? "var(--ctp-surface0)"
                    : "var(--ctp-surface1)",
              color: voice.isRecording() || voice.isConnecting()
                ? "var(--ctp-base)"
                : props.disabled
                  ? "var(--ctp-overlay0)"
                  : "var(--ctp-blue)",
              border: voice.isRecording()
                ? "1px solid var(--ctp-red)"
                : "1px solid var(--ctp-surface2)",
              "border-radius": "6px",
              cursor: props.disabled ? "not-allowed" : "pointer",
              "font-size": "16px",
              "line-height": "1",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              padding: "0",
              "flex-shrink": "0",
              transition: "all 200ms ease",
            }}
          >
            {/* SVG Mic icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </button>
        </Show>

        {/* Partial transcription preview */}
        <Show when={voice.isRecording() && voice.partialText()}>
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: "16px",
              right: "16px",
              padding: "6px 10px",
              background: "var(--ctp-surface0)",
              "border-radius": "6px 6px 0 0",
              "border": "1px solid var(--ctp-surface1)",
              "border-bottom": "none",
              "font-size": "12px",
              color: "var(--ctp-subtext0)",
              "font-style": "italic",
              "max-height": "60px",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {voice.partialText()}
          </div>
        </Show>

        <textarea
          data-testid="chat-input"
          ref={textareaRef}
          value={text()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          disabled={props.disabled}
          placeholder={
            props.disabled
              ? "No active session"
              : "Type a message or paste an image..."
          }
          rows={1}
          style={{
            flex: "1",
            resize: "none",
            background: "var(--ctp-base)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "6px",
            padding: "8px 12px",
            color: "var(--ctp-text)",
            "font-family": "var(--font-mono)",
            "font-size": "13px",
            "line-height": "1.5",
            outline: "none",
            "min-height": "36px",
            "max-height": "200px",
            overflow: "auto",
            transition: "border-color 200ms ease",
          }}
        />
        <button
          data-testid="chat-send"
          onClick={submit}
          disabled={props.disabled || !hasContent()}
          style={{
            background:
              props.disabled || !hasContent()
                ? "var(--ctp-surface1)"
                : "linear-gradient(135deg, #00ff9d, #00b8ff)",
            color:
              props.disabled || !hasContent()
                ? "var(--dim, #68687a)"
                : "var(--void, #020204)",
            border: "none",
            "border-radius": "6px",
            padding: "8px 16px",
            cursor:
              props.disabled || !hasContent() ? "not-allowed" : "pointer",
            "font-size": "12px",
            "font-weight": "700",
            "font-family": "var(--font-mono)",
            "letter-spacing": "0.05em",
            "align-self": "flex-end",
            transition: "all 200ms ease",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
