import { createMemo } from "solid-js";
import { Marked } from "marked";

/** Custom renderer: intercept code blocks for diff highlighting + language badge */
const renderer = {
  code({ text, lang }: { text: string; lang?: string | null }): string {
    const escaped = escapeHtml(text);
    const langClass = lang ? ` class="${escapeHtml(lang)}"` : "";

    // Diff detection: explicit `diff` language or auto-detected diff patterns
    const isDiff = lang === "diff" || (!lang && looksLikeDiff(text));
    if (isDiff) {
      return renderDiffBlock(escaped);
    }

    return `<pre><code${langClass}>${escaped}</code></pre>`;
  },
};

const marked = new Marked({
  breaks: true,
  gfm: true,
  renderer,
});

/** Render markdown text to HTML for display in chat bubbles. */
export default function MarkdownContent(props: { text: string }) {
  const html = createMemo(() => {
    const raw = props.text;
    if (!raw) return "";

    // Fast path: if no markdown syntax detected, return as-is with line breaks
    if (!hasMarkdownSyntax(raw)) {
      return escapeHtml(raw).replace(/\n/g, "<br>");
    }

    try {
      const result = marked.parse(raw);
      // marked.parse can return string or Promise — we configured synchronously
      return typeof result === "string" ? result : "";
    } catch {
      return escapeHtml(raw).replace(/\n/g, "<br>");
    }
  });

  return (
    <div class="md-content" innerHTML={html()} />
  );
}

/** Auto-detect diff patterns: lines starting with +/- or @@ hunks */
function looksLikeDiff(text: string): boolean {
  const lines = text.split("\n").slice(0, 20);
  let diffMarkers = 0;
  for (const line of lines) {
    if (/^[+-]{3}\s/.test(line) || /^@@\s/.test(line) || /^[+-]\s/.test(line)) {
      diffMarkers++;
    }
  }
  return diffMarkers >= 3;
}

/** Render a diff code block with line-by-line coloring */
function renderDiffBlock(escapedText: string): string {
  const lines = escapedText.split("\n");
  const rendered = lines.map((line) => {
    // File header lines (--- a/file, +++ b/file)
    if (/^---\s/.test(line) || /^\+\+\+\s/.test(line)) {
      return `<div class="diff-file-header">${line}</div>`;
    }
    // Hunk headers (@@ -1,3 +1,5 @@)
    if (/^@@/.test(line)) {
      return `<div class="diff-hunk">${line}</div>`;
    }
    // Added lines
    if (line.startsWith("+")) {
      return `<div class="diff-add">${line}</div>`;
    }
    // Removed lines
    if (line.startsWith("-")) {
      return `<div class="diff-del">${line}</div>`;
    }
    // Context lines
    return `<div class="diff-ctx">${line}</div>`;
  }).join("");

  return `<div class="diff-block">${rendered}</div>`;
}

/** Quick check for common markdown patterns to skip parsing plain text. */
function hasMarkdownSyntax(text: string): boolean {
  // Check first 2000 chars for performance
  const sample = text.length > 2000 ? text.substring(0, 2000) : text;
  return /[*_`#\[|~>]|-\s|^\d+\.\s/m.test(sample);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
