import { createSignal, Show } from "solid-js";
import {
  exportMarkdown,
  exportJson,
  exportHtml,
  downloadBlob,
  type ExportOptions,
} from "../../lib/export";
import type { ChatMessage } from "../../types/messages";
import { showToast } from "../../lib/notifications";

type ExportFormat = "markdown" | "json" | "html";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  sessionName: string;
}

export default function ExportDialog(props: ExportDialogProps) {
  const [format, setFormat] = createSignal<ExportFormat>("markdown");
  const [includeThinking, setIncludeThinking] = createSignal(true);
  const [includeHidden, setIncludeHidden] = createSignal(false);
  const [includeToolResults, setIncludeToolResults] = createSignal(true);
  const [includeMetadata, setIncludeMetadata] = createSignal(true);
  const [exporting, setExporting] = createSignal(false);

  function doExport() {
    setExporting(true);
    try {
      const opts: ExportOptions = {
        includeThinking: includeThinking(),
        includeHidden: includeHidden(),
        includeToolResults: includeToolResults(),
        includeMetadata: includeMetadata(),
      };

      const name = props.sessionName || "session";
      const fmt = format();
      let content: string;
      let filename: string;
      let mime: string;

      switch (fmt) {
        case "markdown":
          content = exportMarkdown(props.messages, name, opts);
          filename = `${name}.md`;
          mime = "text/markdown";
          break;
        case "json":
          content = exportJson(props.messages, name, opts);
          filename = `${name}.json`;
          mime = "application/json";
          break;
        case "html":
          content = exportHtml(props.messages, name, opts);
          filename = `${name}.html`;
          mime = "text/html";
          break;
      }

      downloadBlob(content, filename, mime);
      showToast({ type: "success", title: "Export complete", message: `${filename} (${(content.length / 1024).toFixed(1)} KB)` });
      props.onClose();
    } catch (e) {
      showToast({ type: "error", title: "Export failed", message: String(e) });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Show when={props.open}>
      {/* Backdrop */}
      <div
        onClick={() => props.onClose()}
        style={{
          position: "fixed",
          inset: "0",
          background: "rgba(0,0,0,0.6)",
          "z-index": "9000",
          animation: "fade-in 150ms ease-out",
        }}
      />

      {/* Dialog */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          "z-index": "9001",
          width: "min(420px, calc(100vw - 32px))",
          background: "rgba(8,8,16,0.92)",
          "backdrop-filter": "blur(24px)",
          "-webkit-backdrop-filter": "blur(24px)",
          border: "1px solid var(--ctp-surface1)",
          "border-radius": "12px",
          padding: "24px",
          "box-shadow": "0 8px 48px rgba(0,0,0,0.6)",
          animation: "dialog-enter 200ms ease-out",
        }}
      >
        {/* Title */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            "margin-bottom": "20px",
          }}
        >
          <span
            style={{
              "font-size": "14px",
              "font-weight": "700",
              "font-family": "var(--font-mono)",
              "letter-spacing": "0.04em",
              color: "var(--ctp-text)",
            }}
          >
            EXPORT SESSION
          </span>
          <button
            onClick={() => props.onClose()}
            style={{
              background: "none",
              border: "none",
              color: "var(--ctp-overlay0)",
              "font-size": "18px",
              cursor: "pointer",
              padding: "0 4px",
              "line-height": "1",
            }}
          >
            {"\u00D7"}
          </button>
        </div>

        {/* Format selection */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            "margin-bottom": "20px",
          }}
        >
          {(["markdown", "json", "html"] as const).map((fmt) => (
            <button
              onClick={() => setFormat(fmt)}
              style={{
                flex: "1",
                padding: "10px 8px",
                background:
                  format() === fmt
                    ? "rgba(0,184,255,0.08)"
                    : "rgba(255,255,255,0.02)",
                border:
                  format() === fmt
                    ? "1px solid var(--neon-blue, #00b8ff)"
                    : "1px solid var(--ctp-surface1)",
                "border-radius": "8px",
                cursor: "pointer",
                transition: "all 200ms ease",
                transform: format() === fmt ? "scale(1.02)" : "scale(1)",
              }}
            >
              <div
                style={{
                  "font-size": "13px",
                  "font-weight": "700",
                  "font-family": "var(--font-mono)",
                  color:
                    format() === fmt
                      ? "var(--neon-blue, #00b8ff)"
                      : "var(--ctp-subtext0)",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.06em",
                }}
              >
                {fmt === "markdown" ? ".MD" : fmt === "json" ? ".JSON" : ".HTML"}
              </div>
              <div
                style={{
                  "font-size": "10px",
                  color: "var(--ctp-overlay1)",
                  "margin-top": "2px",
                }}
              >
                {fmt === "markdown"
                  ? "Readable"
                  : fmt === "json"
                    ? "Structured"
                    : "Self-contained"}
              </div>
            </button>
          ))}
        </div>

        {/* Options */}
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
            "margin-bottom": "24px",
          }}
        >
          <ToggleOption
            label="Include thinking blocks"
            checked={includeThinking()}
            onChange={setIncludeThinking}
          />
          <ToggleOption
            label="Include hidden messages"
            checked={includeHidden()}
            onChange={setIncludeHidden}
          />
          <ToggleOption
            label="Include tool results"
            checked={includeToolResults()}
            onChange={setIncludeToolResults}
          />
          <ToggleOption
            label="Include metadata"
            checked={includeMetadata()}
            onChange={setIncludeMetadata}
          />
        </div>

        {/* Message count */}
        <div
          style={{
            "font-size": "11px",
            color: "var(--ctp-overlay1)",
            "font-family": "var(--font-mono)",
            "margin-bottom": "16px",
            "text-align": "center",
          }}
        >
          {props.messages.length} messages
        </div>

        {/* Export button */}
        <button
          onClick={doExport}
          disabled={exporting() || props.messages.length === 0}
          style={{
            width: "100%",
            padding: "10px",
            background: "rgba(0,255,157,0.08)",
            border: "1px solid var(--neon-green, #00ff9d)",
            "border-radius": "8px",
            color: "var(--neon-green, #00ff9d)",
            "font-size": "12px",
            "font-weight": "700",
            "font-family": "var(--font-mono)",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
            cursor: exporting() ? "wait" : "pointer",
            opacity: exporting() || props.messages.length === 0 ? "0.5" : "1",
            transition: "all 200ms ease",
          }}
        >
          {exporting() ? "Exporting..." : "Export"}
        </button>
      </div>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dialog-enter {
          from { opacity: 0; transform: translate(-50%, -48%); }
          to { opacity: 1; transform: translate(-50%, -50%); }
        }
      `}</style>
    </Show>
  );
}

// ── Toggle Checkbox ─────────────────────────────────────

function ToggleOption(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        "align-items": "center",
        gap: "10px",
        cursor: "pointer",
        "font-size": "12px",
        color: "var(--ctp-text)",
        "user-select": "none",
      }}
    >
      <div
        onClick={(e) => {
          e.preventDefault();
          props.onChange(!props.checked);
        }}
        style={{
          width: "16px",
          height: "16px",
          "border-radius": "4px",
          border: props.checked
            ? "1px solid var(--neon-blue, #00b8ff)"
            : "1px solid var(--ctp-surface2)",
          background: props.checked
            ? "rgba(0,184,255,0.15)"
            : "transparent",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "flex-shrink": "0",
          transition: "all 150ms ease",
        }}
      >
        <Show when={props.checked}>
          <span
            style={{
              color: "var(--neon-blue, #00b8ff)",
              "font-size": "11px",
              "line-height": "1",
            }}
          >
            {"\u2713"}
          </span>
        </Show>
      </div>
      {props.label}
    </label>
  );
}
