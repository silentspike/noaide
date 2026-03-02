import { Show } from "solid-js";

interface ModelBadgeProps {
  model: string | null;
}

function shortModel(model: string): string {
  const parts = model.split("-");
  if (parts.length >= 3) {
    return parts.slice(0, 3).join("-");
  }
  return model;
}

export default function ModelBadge(props: ModelBadgeProps) {
  return (
    <Show when={props.model}>
      <span
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "9px",
          "font-weight": "700",
          padding: "2px 8px",
          "border-radius": "3px",
          background: "rgba(168,85,247,0.12)",
          color: "var(--neon-purple, #a855f7)",
          "white-space": "nowrap",
          "letter-spacing": "0.03em",
          "text-transform": "uppercase",
        }}
        title={props.model!}
      >
        {shortModel(props.model!)}
      </span>
    </Show>
  );
}
