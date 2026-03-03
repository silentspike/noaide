import { Show, For, createMemo } from "solid-js";
import ToolCardBase from "./ToolCardBase";
import MarkdownContent from "../chat/MarkdownContent";

interface WebSearchCardProps {
  query: string;
  results?: string;
  isError?: boolean;
}

interface SearchLink {
  title: string;
  url: string;
  domain: string;
}

/** Extract domain from URL for display. */
function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Strip system instruction lines from the summary. */
function stripInstructions(text: string): string {
  return text
    .replace(/\n*REMINDER:.*?(?:\n|$)/gs, "")
    .replace(/\n*CRITICAL REQUIREMENT.*?(?:\n|$)/gs, "")
    .replace(/\n*Sources:\s*$/s, "")
    .trim();
}

/** Parse the WebSearch result text into structured data. */
function parseSearchResults(raw: string | undefined): {
  links: SearchLink[];
  summary: string;
} {
  if (!raw) return { links: [], summary: "" };

  let text = raw;
  const links: SearchLink[] = [];

  // Strip the "Web search results for query: ..." header line
  text = text.replace(/^Web search results for query:.*?\n/i, "");

  // Find "Links: [" and extract the JSON array by bracket matching
  const linksIdx = text.indexOf("Links: [");
  if (linksIdx !== -1) {
    const jsonStart = text.indexOf("[", linksIdx);
    if (jsonStart !== -1) {
      // Find matching closing bracket
      let depth = 0;
      let jsonEnd = -1;
      for (let i = jsonStart; i < text.length; i++) {
        if (text[i] === "[") depth++;
        else if (text[i] === "]") {
          depth--;
          if (depth === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
      if (jsonEnd !== -1) {
        const jsonStr = text.substring(jsonStart, jsonEnd);
        try {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item.title && item.url) {
                links.push({
                  title: String(item.title),
                  url: String(item.url),
                  domain: extractDomain(String(item.url)),
                });
              }
            }
          }
        } catch {
          // JSON parsing failed — leave links empty
        }
        // Remove the "Links: [...]" section from text
        const lineStart = text.lastIndexOf("\n", linksIdx);
        const lineEnd = text.indexOf("\n", jsonEnd);
        text = text.substring(0, lineStart === -1 ? 0 : lineStart)
          + text.substring(lineEnd === -1 ? text.length : lineEnd);
      }
    }
  }

  // Also try markdown-style links: [Title](URL) — fallback
  if (links.length === 0) {
    const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let match;
    while ((match = mdLinkRegex.exec(raw)) !== null) {
      links.push({
        title: match[1],
        url: match[2],
        domain: extractDomain(match[2]),
      });
    }
  }

  return { links, summary: stripInstructions(text.trim()) };
}

export default function WebSearchCard(props: WebSearchCardProps) {
  const parsed = createMemo(() => parseSearchResults(props.results));

  return (
    <ToolCardBase toolName="WebSearch" isError={props.isError}>
      <div
        style={{
          "font-size": "12px",
          color: "var(--ctp-sapphire)",
          "margin-bottom": "6px",
          "font-weight": "500",
        }}
      >
        Search: {props.query}
      </div>

      <Show when={parsed().links.length > 0}>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            "margin-bottom": "8px",
            "padding-left": "8px",
            "border-left": "2px solid var(--ctp-surface2)",
          }}
        >
          <For each={parsed().links}>
            {(link) => (
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  "font-size": "11px",
                  color: "var(--ctp-blue)",
                  "text-decoration": "none",
                  display: "flex",
                  "flex-direction": "column",
                  gap: "1px",
                  padding: "2px 0",
                }}
                title={link.url}
              >
                <span
                  style={{
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {link.title}
                </span>
                <span
                  style={{
                    "font-size": "10px",
                    color: "var(--ctp-overlay0)",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {link.domain}
                </span>
              </a>
            )}
          </For>
          <span
            style={{
              "font-size": "10px",
              color: "var(--ctp-overlay0)",
              "margin-top": "2px",
            }}
          >
            {parsed().links.length} result{parsed().links.length !== 1 ? "s" : ""}
          </span>
        </div>
      </Show>

      <Show when={parsed().summary}>
        <div
          style={{
            "font-size": "12px",
            "line-height": "1.6",
            color: "var(--ctp-subtext0)",
          }}
        >
          <MarkdownContent text={parsed().summary} />
        </div>
      </Show>
    </ToolCardBase>
  );
}
