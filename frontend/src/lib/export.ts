/**
 * Session Export — Markdown, JSON, HTML formatters.
 * Operates on in-memory messages (no network I/O).
 */

import type { ChatMessage, ContentBlock } from "../types/messages";

export interface ExportOptions {
  includeThinking: boolean;
  includeHidden: boolean;
  includeToolResults: boolean;
  includeMetadata: boolean; // timestamps, tokens, cost
}

const DEFAULT_OPTIONS: ExportOptions = {
  includeThinking: true,
  includeHidden: false,
  includeToolResults: true,
  includeMetadata: true,
};

// ── Filters ─────────────────────────────────────────────

function filterMessages(
  messages: ChatMessage[],
  opts: ExportOptions,
): ChatMessage[] {
  return messages.filter((msg) => {
    if (msg.hidden && !opts.includeHidden) return false;
    if (msg.isGhost) return false;
    if (msg.role === "meta") return false;
    return true;
  });
}

function blockText(block: ContentBlock): string {
  if (block.type === "text") return block.text ?? "";
  if (block.type === "thinking") return block.thinking ?? block.text ?? "";
  if (block.type === "tool_result") {
    if (typeof block.content === "string") return block.content;
    if (Array.isArray(block.content)) {
      return block.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
    }
    return "";
  }
  return "";
}

function formatTimestamp(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Markdown ────────────────────────────────────────────

export function exportMarkdown(
  messages: ChatMessage[],
  sessionName: string,
  opts: Partial<ExportOptions> = {},
): string {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const filtered = filterMessages(messages, o);
  const lines: string[] = [];

  lines.push(`# ${sessionName}`);
  lines.push("");
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push(`Messages: ${filtered.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of filtered) {
    const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : msg.role;

    if (o.includeMetadata && msg.timestamp) {
      lines.push(`### ${role} — ${formatTimestamp(msg.timestamp)}`);
    } else {
      lines.push(`### ${role}`);
    }
    lines.push("");

    for (const block of msg.content) {
      switch (block.type) {
        case "text":
          if (msg.role === "user") {
            lines.push(`> ${(block.text ?? "").replace(/\n/g, "\n> ")}`);
          } else {
            lines.push(block.text ?? "");
          }
          lines.push("");
          break;

        case "thinking":
          if (o.includeThinking) {
            lines.push("<details>");
            lines.push("<summary>Thinking</summary>");
            lines.push("");
            lines.push(blockText(block));
            lines.push("");
            lines.push("</details>");
            lines.push("");
          }
          break;

        case "tool_use":
          lines.push(`**Tool:** \`${block.name ?? "unknown"}\``);
          if (block.input) {
            lines.push("```json");
            lines.push(JSON.stringify(block.input, null, 2));
            lines.push("```");
          }
          lines.push("");
          break;

        case "tool_result":
          if (o.includeToolResults) {
            const text = blockText(block);
            if (text) {
              lines.push("```");
              // Limit tool result output to prevent huge exports
              const truncated = text.length > 2000 ? text.slice(0, 2000) + "\n... (truncated)" : text;
              lines.push(truncated);
              lines.push("```");
              lines.push("");
            }
          }
          break;

        case "image":
          lines.push("*[Image]*");
          lines.push("");
          break;
      }
    }

    if (o.includeMetadata) {
      const meta: string[] = [];
      if (msg.model) meta.push(`model: ${msg.model}`);
      if (msg.inputTokens) meta.push(`in: ${msg.inputTokens}`);
      if (msg.outputTokens) meta.push(`out: ${msg.outputTokens}`);
      if (msg.costUsd) meta.push(`cost: $${msg.costUsd.toFixed(4)}`);
      if (msg.durationMs) meta.push(`${msg.durationMs}ms`);
      if (meta.length > 0) {
        lines.push(`*${meta.join(" | ")}*`);
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ── JSON ────────────────────────────────────────────────

export function exportJson(
  messages: ChatMessage[],
  sessionName: string,
  opts: Partial<ExportOptions> = {},
): string {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const filtered = filterMessages(messages, o);

  const cleaned = filtered.map((msg) => {
    const blocks = msg.content.filter((b) => {
      if (b.type === "thinking" && !o.includeThinking) return false;
      if (b.type === "tool_result" && !o.includeToolResults) return false;
      return true;
    });

    const entry: Record<string, unknown> = {
      role: msg.role,
      content: blocks.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "thinking") return { type: "thinking", text: blockText(b) };
        if (b.type === "tool_use") return { type: "tool_use", name: b.name, input: b.input };
        if (b.type === "tool_result") {
          const text = blockText(b);
          return {
            type: "tool_result",
            tool_use_id: b.tool_use_id,
            content: text.length > 2000 ? text.slice(0, 2000) : text,
            is_error: b.is_error,
          };
        }
        if (b.type === "image") return { type: "image" };
        return { type: b.type };
      }),
    };

    if (o.includeMetadata) {
      if (msg.timestamp) entry.timestamp = msg.timestamp;
      if (msg.model) entry.model = msg.model;
      if (msg.inputTokens) entry.inputTokens = msg.inputTokens;
      if (msg.outputTokens) entry.outputTokens = msg.outputTokens;
      if (msg.costUsd) entry.costUsd = msg.costUsd;
      if (msg.durationMs) entry.durationMs = msg.durationMs;
    }

    return entry;
  });

  return JSON.stringify(
    {
      session: sessionName,
      exportedAt: new Date().toISOString(),
      messageCount: cleaned.length,
      messages: cleaned,
    },
    null,
    2,
  );
}

// ── HTML ────────────────────────────────────────────────

export function exportHtml(
  messages: ChatMessage[],
  sessionName: string,
  opts: Partial<ExportOptions> = {},
): string {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const filtered = filterMessages(messages, o);

  const escapeHtml = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const msgHtml = filtered.map((msg) => {
    const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : msg.role;
    const roleClass = msg.role === "user" ? "user" : "assistant";
    const blocks: string[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case "text":
          blocks.push(`<div class="text">${escapeHtml(block.text ?? "").replace(/\n/g, "<br>")}</div>`);
          break;
        case "thinking":
          if (o.includeThinking) {
            blocks.push(
              `<details class="thinking"><summary>Thinking</summary><pre>${escapeHtml(blockText(block))}</pre></details>`,
            );
          }
          break;
        case "tool_use":
          blocks.push(
            `<div class="tool-use"><span class="tool-name">${escapeHtml(block.name ?? "")}</span>${
              block.input ? `<pre>${escapeHtml(JSON.stringify(block.input, null, 2))}</pre>` : ""
            }</div>`,
          );
          break;
        case "tool_result":
          if (o.includeToolResults) {
            const text = blockText(block);
            if (text) {
              const truncated = text.length > 2000 ? text.slice(0, 2000) + "\n... (truncated)" : text;
              blocks.push(`<pre class="tool-result${block.is_error ? " error" : ""}">${escapeHtml(truncated)}</pre>`);
            }
          }
          break;
        case "image":
          blocks.push(`<div class="image-placeholder">[Image]</div>`);
          break;
      }
    }

    const metaParts: string[] = [];
    if (o.includeMetadata) {
      if (msg.timestamp) metaParts.push(formatTimestamp(msg.timestamp));
      if (msg.model) metaParts.push(msg.model);
      if (msg.costUsd) metaParts.push(`$${msg.costUsd.toFixed(4)}`);
    }

    return `<div class="message ${roleClass}">
  <div class="role">${escapeHtml(role)}${metaParts.length ? ` <span class="meta">${escapeHtml(metaParts.join(" | "))}</span>` : ""}</div>
  ${blocks.join("\n  ")}
</div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(sessionName)} — noaide export</title>
<style>
:root{--base:#1e1e2e;--mantle:#181825;--surface0:#313244;--surface1:#45475a;--text:#cdd6f4;--subtext0:#a6adc8;--blue:#89b4fa;--green:#a6e3a1;--mauve:#cba6f7;--red:#f38ba8;--peach:#fab387;--yellow:#f9e2af}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--base);color:var(--text);font-family:Inter,-apple-system,system-ui,sans-serif;font-size:14px;line-height:1.6;padding:24px;max-width:900px;margin:0 auto}
h1{font-size:20px;font-weight:700;margin-bottom:4px;color:var(--text)}
.export-info{font-size:12px;color:var(--subtext0);margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--surface0)}
.message{margin-bottom:16px;padding:12px 16px;border-radius:8px;border:1px solid var(--surface0)}
.message.user{background:rgba(137,180,250,0.06);border-color:rgba(137,180,250,0.15)}
.message.assistant{background:rgba(203,166,247,0.04);border-color:rgba(203,166,247,0.10)}
.role{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;color:var(--subtext0)}
.meta{font-weight:400;font-size:10px;opacity:0.7}
.text{white-space:pre-wrap;word-break:break-word}
pre{background:var(--mantle);padding:10px 12px;border-radius:6px;font-family:'Monaspace Neon',monospace;font-size:12px;overflow-x:auto;margin:6px 0;border:1px solid var(--surface0)}
.thinking summary{cursor:pointer;font-size:11px;color:var(--mauve);font-weight:600;text-transform:uppercase;letter-spacing:0.04em}
.thinking pre{border-color:rgba(203,166,247,0.15)}
.tool-use{margin:6px 0}
.tool-name{font-size:11px;font-weight:700;color:var(--peach);font-family:monospace;padding:2px 6px;background:rgba(250,179,135,0.08);border-radius:4px}
.tool-result{font-size:11px;color:var(--subtext0)}
.tool-result.error{border-color:rgba(243,139,168,0.3);color:var(--red)}
.image-placeholder{font-size:12px;color:var(--subtext0);font-style:italic}
</style>
</head>
<body>
<h1>${escapeHtml(sessionName)}</h1>
<div class="export-info">Exported: ${new Date().toISOString()} | Messages: ${filtered.length}</div>
${msgHtml}
</body>
</html>`;
}

// ── Download Helper ─────────────────────────────────────

export function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });

  // Try Web Share API on mobile
  if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
    const file = new File([blob], filename, { type: mimeType });
    navigator.share({ files: [file], title: filename }).catch(() => {
      // Fallback to download
      triggerDownload(blob, filename);
    });
    return;
  }

  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
