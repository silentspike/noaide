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
          "font-size": "10px",
          padding: "2px 8px",
          "border-radius": "4px",
          background: "var(--ctp-surface0)",
          color: "var(--ctp-subtext0)",
          "white-space": "nowrap",
        }}
        title={props.model!}
      >
        {shortModel(props.model!)}
      </span>
    </Show>
  );
}
