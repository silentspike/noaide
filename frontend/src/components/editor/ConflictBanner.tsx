import { Show } from "solid-js";

interface ConflictBannerProps {
  active: boolean;
  fileName?: string;
}

export default function ConflictBanner(props: ConflictBannerProps) {
  return (
    <Show when={props.active}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "6px 12px",
          background: "rgba(249, 226, 175, 0.12)",
          "border-bottom": "1px solid var(--ctp-yellow)",
          color: "var(--ctp-yellow)",
          "font-size": "12px",
          "font-weight": "500",
          animation: "pulse-banner 2s ease-in-out infinite",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            "border-radius": "50%",
            background: "var(--ctp-yellow)",
            animation: "pulse-dot 1s ease-in-out infinite",
          }}
        />
        <span>
          Claude is editing{" "}
          <Show when={props.fileName}>
            <strong style={{ "font-family": "var(--font-mono)", "font-size": "11px" }}>
              {props.fileName}
            </strong>
          </Show>
        </span>
        <span
          style={{
            "margin-left": "auto",
            "font-size": "10px",
            color: "var(--ctp-overlay0)",
          }}
        >
          Your edits are buffered
        </span>
      </div>
    </Show>
  );
}
