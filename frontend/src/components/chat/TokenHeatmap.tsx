import { Show } from "solid-js";
import type { ChatMessage } from "../../types/messages";
import { totalTokens } from "../../types/messages";

interface TokenHeatmapProps {
  message: ChatMessage;
  maxTokens: number;
}

function tokenColor(tokens: number, max: number): string {
  if (max <= 0) return "var(--ctp-surface1)";
  const ratio = Math.min(tokens / max, 1);
  if (ratio < 0.25) return "var(--ctp-green)";
  if (ratio < 0.5) return "var(--ctp-yellow)";
  if (ratio < 0.75) return "var(--ctp-peach)";
  return "var(--ctp-red)";
}

export default function TokenHeatmap(props: TokenHeatmapProps) {
  const tokens = () => totalTokens(props.message);

  return (
    <Show when={tokens() > 0}>
      <div
        style={{
          width: "3px",
          "min-height": "20px",
          "border-radius": "2px",
          background: tokenColor(tokens(), props.maxTokens),
          "flex-shrink": "0",
          "align-self": "stretch",
          opacity: "0.6",
        }}
        title={`${tokens().toLocaleString()} tokens`}
      />
    </Show>
  );
}
