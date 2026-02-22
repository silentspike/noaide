import { onMount, onCleanup, Show } from "solid-js";
import { MergeView } from "@codemirror/merge";
import { EditorView, lineNumbers } from "@codemirror/view";

interface DiffViewProps {
  original: string;
  modified: string;
  onAccept?: (content: string) => void;
  onReject?: () => void;
}

export default function DiffView(props: DiffViewProps) {
  let containerRef: HTMLDivElement | undefined;
  let mergeView: MergeView | undefined;

  onMount(() => {
    if (!containerRef) return;

    mergeView = new MergeView({
      parent: containerRef,
      a: {
        doc: props.original,
        extensions: [
          EditorView.editable.of(false),
          lineNumbers(),
          EditorView.theme({
            "&": { height: "100%", fontSize: "12px" },
            ".cm-content": { fontFamily: "var(--font-mono)" },
            ".cm-gutters": {
              background: "var(--ctp-mantle)",
              color: "var(--ctp-overlay0)",
              border: "none",
            },
            "&.cm-editor": { background: "var(--ctp-base)" },
            ".cm-line": { padding: "0 4px" },
          }),
        ],
      },
      b: {
        doc: props.modified,
        extensions: [
          lineNumbers(),
          EditorView.theme({
            "&": { height: "100%", fontSize: "12px" },
            ".cm-content": { fontFamily: "var(--font-mono)" },
            ".cm-gutters": {
              background: "var(--ctp-mantle)",
              color: "var(--ctp-overlay0)",
              border: "none",
            },
            "&.cm-editor": { background: "var(--ctp-base)" },
            ".cm-line": { padding: "0 4px" },
          }),
        ],
      },
    });
  });

  onCleanup(() => {
    mergeView?.destroy();
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "6px 12px",
          background: "var(--ctp-mantle)",
          "border-bottom": "1px solid var(--ctp-surface0)",
          "font-size": "12px",
          color: "var(--ctp-subtext0)",
        }}
      >
        <span style={{ "font-weight": "600" }}>Merge View</span>
        <span style={{ color: "var(--ctp-overlay0)" }}>
          Original vs Modified
        </span>
        <div style={{ "margin-left": "auto", display: "flex", gap: "6px" }}>
          <Show when={props.onAccept}>
            <button
              onClick={() => {
                const doc = mergeView?.b.state.doc;
                props.onAccept?.(doc?.toString() ?? props.modified);
              }}
              style={{
                padding: "2px 10px",
                background: "var(--ctp-green)",
                color: "var(--ctp-base)",
                border: "none",
                "border-radius": "4px",
                cursor: "pointer",
                "font-size": "11px",
                "font-weight": "600",
              }}
            >
              Accept
            </button>
          </Show>
          <Show when={props.onReject}>
            <button
              onClick={() => props.onReject?.()}
              style={{
                padding: "2px 10px",
                background: "var(--ctp-surface1)",
                color: "var(--ctp-text)",
                border: "none",
                "border-radius": "4px",
                cursor: "pointer",
                "font-size": "11px",
              }}
            >
              Reject
            </button>
          </Show>
        </div>
      </div>
      <div
        ref={containerRef}
        style={{ flex: "1", overflow: "auto" }}
      />
    </div>
  );
}
