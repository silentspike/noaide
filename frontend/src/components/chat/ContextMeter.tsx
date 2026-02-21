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

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "font-size": "11px",
        color: "var(--ctp-subtext0)",
        padding: "0 4px",
      }}
    >
      <div
        style={{
          flex: "1",
          height: "4px",
          background: "var(--ctp-surface0)",
          "border-radius": "2px",
          overflow: "hidden",
          "min-width": "60px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(ratio() * 100, 100)}%`,
            background: meterColor(ratio()),
            "border-radius": "2px",
            transition: "width 300ms ease, background 300ms ease",
          }}
        />
      </div>
      <span style={{ "white-space": "nowrap" }}>
        {formatTokens(props.used)} / {formatTokens(props.max)}
      </span>
    </div>
  );
}
