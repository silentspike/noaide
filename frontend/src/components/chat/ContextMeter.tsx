interface ContextMeterProps {
  used: number;
  max: number;
}

function meterColor(ratio: number): string {
  if (ratio < 0.5) return "var(--ctp-green)";
  if (ratio < 0.8) return "var(--ctp-yellow)";
  return "var(--ctp-red)";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

export default function ContextMeter(props: ContextMeterProps) {
  const ratio = () => (props.max > 0 ? props.used / props.max : 0);
  const pctLeft = () => props.max > 0 ? Math.max(0, Math.round((1 - ratio()) * 100)) : 100;

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "6px",
        "font-size": "10px",
        "font-family": "var(--font-mono)",
        color: "var(--dim, #68687a)",
        padding: "0 4px",
      }}
      title={`${formatTokens(props.used)} / ${formatTokens(props.max)} tokens used (${pctLeft()}% remaining)`}
    >
      <div
        style={{
          flex: "1",
          height: "3px",
          background: "var(--ctp-surface1)",
          "border-radius": "2px",
          overflow: "hidden",
          "min-width": "40px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(ratio() * 100, 100)}%`,
            background: meterColor(ratio()),
            "border-radius": "2px",
            transition: "width 300ms ease, background 300ms ease",
            "box-shadow": `0 0 6px ${meterColor(ratio())}`,
          }}
        />
      </div>
      <span
        style={{
          "white-space": "nowrap",
          color: ratio() > 0.8 ? "var(--ctp-red)" : ratio() > 0.5 ? "var(--ctp-yellow)" : "var(--ctp-subtext0)",
          "font-weight": ratio() > 0.8 ? "600" : "400",
        }}
      >
        {formatTokens(props.used)} / {formatTokens(props.max)} ({pctLeft()}%)
      </span>
    </div>
  );
}
