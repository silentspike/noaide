import { onMount, onCleanup, createSignal, Show } from "solid-js";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, keymap } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import ConflictBanner from "./ConflictBanner";
import DiffView from "./DiffView";

interface EditorPanelProps {
  filePath?: string;
  content?: string;
  readOnly?: boolean;
}

function languageFromPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return javascript({ jsx: ext.endsWith("x"), typescript: ext.startsWith("t") });
    case "rs":
      return rust();
    case "py":
      return python();
    case "json":
      return json();
    case "css":
      return css();
    case "html":
      return html();
    case "md":
      return markdown();
    default:
      return null;
  }
}

const catppuccinTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    background: "var(--ctp-base)",
    color: "var(--ctp-text)",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    caretColor: "var(--ctp-rosewater)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--ctp-rosewater)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "var(--ctp-surface2) !important",
  },
  ".cm-activeLine": {
    background: "rgba(88, 91, 112, 0.15)",
  },
  ".cm-gutters": {
    background: "var(--ctp-mantle)",
    color: "var(--ctp-overlay0)",
    border: "none",
    "border-right": "1px solid var(--ctp-surface0)",
  },
  ".cm-activeLineGutter": {
    background: "rgba(88, 91, 112, 0.15)",
    color: "var(--ctp-text)",
  },
  ".cm-foldPlaceholder": {
    background: "var(--ctp-surface1)",
    color: "var(--ctp-overlay1)",
    border: "none",
  },
  ".cm-tooltip": {
    background: "var(--ctp-surface0)",
    border: "1px solid var(--ctp-surface1)",
    color: "var(--ctp-text)",
  },
  ".cm-searchMatch": {
    background: "rgba(249, 226, 175, 0.3)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    background: "rgba(249, 226, 175, 0.5)",
  },
});

export default function EditorPanel(props: EditorPanelProps) {
  let containerRef: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;
  const [claudeEditing, setClaudeEditing] = createSignal(false);
  const [showDiff, setShowDiff] = createSignal(false);
  const [diffOriginal, setDiffOriginal] = createSignal("");
  const [diffModified, setDiffModified] = createSignal("");

  onMount(() => {
    if (!containerRef) return;

    const extensions = [
      lineNumbers(),
      catppuccinTheme,
      EditorView.lineWrapping,
      EditorState.readOnly.of(props.readOnly ?? false),
    ];

    const lang = props.filePath ? languageFromPath(props.filePath) : null;
    if (lang) extensions.push(lang);

    editorView = new EditorView({
      state: EditorState.create({
        doc: props.content ?? "",
        extensions,
      }),
      parent: containerRef,
    });
  });

  onCleanup(() => {
    editorView?.destroy();
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--ctp-base)",
      }}
    >
      {/* File tab bar */}
      <Show when={props.filePath}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            padding: "0 12px",
            height: "32px",
            background: "var(--ctp-mantle)",
            "border-bottom": "1px solid var(--ctp-surface0)",
            "font-size": "12px",
          }}
        >
          <span
            style={{
              "font-family": "var(--font-mono)",
              color: "var(--ctp-text)",
              padding: "4px 8px",
              "border-bottom": "2px solid var(--ctp-blue)",
            }}
          >
            {props.filePath!.split("/").pop()}
          </span>
          <span
            style={{
              "margin-left": "8px",
              "font-size": "10px",
              color: "var(--ctp-overlay0)",
            }}
          >
            {props.filePath}
          </span>
        </div>
      </Show>

      {/* Conflict banner */}
      <ConflictBanner
        active={claudeEditing()}
        fileName={props.filePath?.split("/").pop()}
      />

      {/* Editor or Diff view */}
      <Show
        when={!showDiff()}
        fallback={
          <DiffView
            original={diffOriginal()}
            modified={diffModified()}
            onAccept={() => setShowDiff(false)}
            onReject={() => setShowDiff(false)}
          />
        }
      >
        <Show
          when={props.filePath}
          fallback={
            <div
              style={{
                flex: "1",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: "var(--ctp-overlay0)",
                "font-size": "13px",
              }}
            >
              Select a file to edit
            </div>
          }
        >
          <div
            ref={containerRef}
            style={{ flex: "1", overflow: "auto" }}
          />
        </Show>
      </Show>
    </div>
  );
}
