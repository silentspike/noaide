import type { OrbState } from "../../types/messages";
import "./BreathingOrb.css";

interface BreathingOrbProps {
  state: OrbState;
}

const STATE_CONFIG: Record<
  OrbState,
  { color: string; label: string; className: string }
> = {
  idle: {
    color: "var(--ctp-lavender)",
    label: "Idle",
    className: "orb--idle",
  },
  thinking: {
    color: "var(--ctp-mauve)",
    label: "Thinking",
    className: "orb--thinking",
  },
  streaming: {
    color: "var(--ctp-blue)",
    label: "Streaming",
    className: "orb--streaming",
  },
  tool_use: {
    color: "var(--ctp-peach)",
    label: "Tool Use",
    className: "orb--tool-use",
  },
  error: {
    color: "var(--ctp-red)",
    label: "Error",
    className: "orb--error",
  },
};

export default function BreathingOrb(props: BreathingOrbProps) {
  const config = () => STATE_CONFIG[props.state];

  return (
    <div class="orb-container" title={config().label}>
      <div
        class={`orb ${config().className}`}
        style={{ "--orb-color": config().color }}
      />
    </div>
  );
}
