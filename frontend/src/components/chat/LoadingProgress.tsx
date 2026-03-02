import { createMemo } from "solid-js";
import type { LoadingProgress as LoadingProgressState } from "../../stores/session";

interface LoadingProgressProps {
  progress: LoadingProgressState;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatEta(seconds: number): string {
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `~${mins}m ${secs}s`;
}

export default function LoadingProgress(props: LoadingProgressProps) {
  const percent = createMemo(() => {
    const { bytesLoaded, bytesTotal } = props.progress;
    if (bytesTotal <= 0) return -1; // indeterminate
    return Math.min((bytesLoaded / bytesTotal) * 100, 100);
  });

  const eta = createMemo(() => {
    const { bytesLoaded, bytesTotal, startTime } = props.progress;
    if (bytesTotal <= 0 || bytesLoaded <= 0) return null;
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed < 0.5) return null; // too early to estimate
    const rate = bytesLoaded / elapsed;
    const remaining = bytesTotal - bytesLoaded;
    if (remaining <= 0) return "parsing...";
    return formatEta(remaining / rate);
  });

  const isIndeterminate = () => percent() < 0;

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        height: "100%",
        gap: "16px",
        padding: "32px",
      }}
    >
      {/* Pulsing orb */}
      <div
        style={{
          width: "16px",
          height: "16px",
          "border-radius": "50%",
          background: "var(--neon-blue, #00b8ff)",
          "box-shadow": "0 0 20px var(--neon-blue, #00b8ff), 0 0 6px var(--neon-blue, #00b8ff)",
          animation: "orb-pulse 1s ease-in-out infinite",
        }}
      />

      {/* Title */}
      <div
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "11px",
          "font-weight": "700",
          "text-transform": "uppercase",
          "letter-spacing": "0.12em",
          color: "var(--dim, #68687a)",
        }}
      >
        loading session
      </div>

      {/* Progress bar container */}
      <div
        style={{
          width: "240px",
          "max-width": "80%",
          display: "flex",
          "flex-direction": "column",
          gap: "8px",
        }}
      >
        {/* Bar track */}
        <div
          style={{
            height: "4px",
            background: "var(--ctp-surface1, #252535)",
            "border-radius": "2px",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {isIndeterminate() ? (
            <div
              style={{
                height: "100%",
                width: "40%",
                background: "linear-gradient(90deg, transparent, var(--neon-blue, #00b8ff), transparent)",
                "border-radius": "2px",
                animation: "loading-slide 1.5s ease-in-out infinite",
                position: "absolute",
              }}
            />
          ) : (
            <div
              style={{
                height: "100%",
                width: `${percent()}%`,
                background: "linear-gradient(90deg, var(--neon-green, #00ff9d), var(--neon-blue, #00b8ff))",
                "border-radius": "2px",
                transition: "width 200ms ease",
                "box-shadow": `0 0 8px var(--neon-blue, #00b8ff)`,
              }}
            />
          )}
        </div>

        {/* Stats line */}
        <div
          style={{
            display: "flex",
            "justify-content": "space-between",
            "font-family": "var(--font-mono)",
            "font-size": "10px",
            color: "var(--dim, #68687a)",
          }}
        >
          <span>
            {isIndeterminate()
              ? formatBytes(props.progress.bytesLoaded)
              : `${percent().toFixed(0)}%`}
            {" "}
            <span style={{ opacity: "0.5" }}>
              ({formatBytes(props.progress.bytesLoaded)}
              {props.progress.bytesTotal > 0
                ? ` / ${formatBytes(props.progress.bytesTotal)}`
                : ""}
              )
            </span>
          </span>
          <span>
            {eta() !== null ? (
              <span>
                ETA: <span style={{ color: "var(--neon-blue, #00b8ff)" }}>{eta()}</span>
              </span>
            ) : (
              <span style={{ opacity: "0.3" }}>calculating...</span>
            )}
          </span>
        </div>

        {/* Expected messages */}
        {props.progress.messagesExpected > 0 && (
          <div
            style={{
              "text-align": "center",
              "font-family": "var(--font-mono)",
              "font-size": "9px",
              color: "var(--dim, #68687a)",
              opacity: "0.6",
            }}
          >
            {props.progress.messagesExpected.toLocaleString()} messages
          </div>
        )}
      </div>
    </div>
  );
}
