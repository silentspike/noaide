/** Frontend mirror of server-side ClaudeMessage / ContentBlock types */

export type MessageRole = "user" | "assistant" | "system";

export type OrbState = "idle" | "thinking" | "streaming" | "tool_use" | "error";

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "image";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  source?: ImageSource;
}

export interface ImageSource {
  type: string;
  media_type: string;
  data: string;
}

export interface ChatMessage {
  uuid: string;
  role: MessageRole;
  messageType: string;
  content: ContentBlock[];
  timestamp?: string;
  model?: string;
  stopReason?: string;
  costUsd?: number;
  durationMs?: number;
  isSidechain?: boolean;
  parentUuid?: string;
  agentId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  isGhost?: boolean;
  hidden?: boolean;
}

export function totalTokens(msg: ChatMessage): number {
  return (
    (msg.inputTokens ?? 0) +
    (msg.outputTokens ?? 0) +
    (msg.cacheCreationInputTokens ?? 0) +
    (msg.cacheReadInputTokens ?? 0)
  );
}

export function hasThinking(msg: ChatMessage): boolean {
  return msg.content.some((b) => b.type === "thinking");
}

export function hasToolUse(msg: ChatMessage): boolean {
  return msg.content.some((b) => b.type === "tool_use");
}

export function hasToolResult(msg: ChatMessage): boolean {
  return msg.content.some((b) => b.type === "tool_result");
}

export function textContent(msg: ChatMessage): string {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}
