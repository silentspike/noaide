import { Index } from "solid-js";

export default function SkeletonLoader(props: {
  width?: string;
  height?: string;
  lines?: number;
  borderRadius?: string;
}) {
  const lines = () => props.lines ?? 1;
  const radius = () => props.borderRadius ?? "4px";

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
      <Index each={Array.from({ length: lines() })}>
        {(_, i) => (
          <div
            style={{
              width: i === lines() - 1 && lines() > 1 ? "70%" : (props.width ?? "100%"),
              height: props.height ?? "14px",
              background: "linear-gradient(90deg, var(--ctp-surface0) 25%, var(--ctp-surface1) 50%, var(--ctp-surface0) 75%)",
              "background-size": "200% 100%",
              "border-radius": radius(),
              animation: "skeleton-shimmer 1.5s infinite",
            }}
          />
        )}
      </Index>
      <style>{`
        @keyframes skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
