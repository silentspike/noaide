import { createSignal } from "solid-js";

interface InputFieldProps {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

export default function InputField(props: InputFieldProps) {
  const [text, setText] = createSignal("");
  let textareaRef: HTMLTextAreaElement | undefined;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const t = text().trim();
    if (!t || props.disabled) return;
    props.onSubmit(t);
    setText("");
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

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        padding: "12px 16px",
        "border-top": "1px solid var(--ctp-surface0)",
        background: "var(--ctp-mantle)",
      }}
    >
      <textarea
        ref={textareaRef}
        value={text()}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        disabled={props.disabled}
        placeholder={
          props.disabled ? "No active session" : "Type a message..."
        }
        rows={1}
        style={{
          flex: "1",
          resize: "none",
          background: "var(--ctp-surface0)",
          border: "1px solid var(--ctp-surface1)",
          "border-radius": "8px",
          padding: "8px 12px",
          color: "var(--ctp-text)",
          "font-family": "var(--font-sans)",
          "font-size": "13px",
          "line-height": "1.5",
          outline: "none",
          "min-height": "36px",
          "max-height": "200px",
          overflow: "auto",
        }}
      />
      <button
        onClick={submit}
        disabled={props.disabled || text().trim() === ""}
        style={{
          background:
            props.disabled || text().trim() === ""
              ? "var(--ctp-surface1)"
              : "var(--ctp-blue)",
          color:
            props.disabled || text().trim() === ""
              ? "var(--ctp-overlay0)"
              : "var(--ctp-crust)",
          border: "none",
          "border-radius": "8px",
          padding: "8px 16px",
          cursor:
            props.disabled || text().trim() === ""
              ? "not-allowed"
              : "pointer",
          "font-size": "13px",
          "font-weight": "600",
          "align-self": "flex-end",
          transition: "background 150ms ease",
        }}
      >
        Send
      </button>
    </div>
  );
}
