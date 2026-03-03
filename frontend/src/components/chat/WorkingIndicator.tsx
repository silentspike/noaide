import { Show, createSignal, createEffect, onCleanup } from "solid-js";
import type { OrbState } from "../../types/messages";

interface WorkingIndicatorProps {
  orbState: OrbState;
  contextTokensUsed: number;
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function stateLabel(orb: OrbState): string {
  switch (orb) {
    case "thinking":
      return "thinking";
    case "streaming":
      return "streaming";
    case "tool_use":
      return "running tool";
    default:
      return "";
  }
}

function stateColor(orb: OrbState): string {
  switch (orb) {
    case "thinking":
      return "var(--ctp-mauve)";
    case "streaming":
      return "var(--ctp-blue)";
    case "tool_use":
      return "var(--ctp-peach)";
    default:
      return "var(--ctp-blue)";
  }
}

export default function WorkingIndicator(props: WorkingIndicatorProps) {
  const [elapsed, setElapsed] = createSignal(0);
  let startTimestamp = 0;

  const isWorking = () =>
    props.orbState !== "idle" && props.orbState !== "error";

  // Reset timer when transitioning to working state
  createEffect(() => {
    if (isWorking()) {
      if (startTimestamp === 0) {
        startTimestamp = Date.now();
        setElapsed(0);
      }
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimestamp) / 1000));
      }, 1000);
      onCleanup(() => clearInterval(interval));
    } else {
      startTimestamp = 0;
      setElapsed(0);
    }
  });

  return (
    <Show when={isWorking()}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "4px 16px",
          "font-size": "11px",
          "font-family": "var(--font-mono)",
          color: "var(--ctp-subtext0)",
          "border-top": "1px solid var(--ctp-surface0)",
          background: "rgba(14,14,24,0.6)",
        }}
      >
        <span
          style={{
            color: stateColor(props.orbState),
            "font-weight": "500",
            display: "flex",
            "align-items": "center",
            gap: "6px",
          }}
        >
          <span class="working-dot" />
          Working...
        </span>
        <span>{formatElapsed(elapsed())}</span>
        <Show when={props.contextTokensUsed > 0}>
          <span style={{ color: "var(--ctp-overlay0)" }}>
            {formatTokens(props.contextTokensUsed)} tokens
          </span>
        </Show>
        <span style={{ color: stateColor(props.orbState), opacity: "0.7" }}>
          {stateLabel(props.orbState)}
        </span>
      </div>
    </Show>
  );
}
