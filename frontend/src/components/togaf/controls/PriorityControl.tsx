import { type Component } from "solid-js";
import type { Priority } from "../types/plan";

interface Props {
  value: Priority;
  onChange?: (priority: Priority) => void;
}

const PRIORITY_STYLES: Record<Priority, { bg: string; text: string; label: string }> = {
  must:   { bg: "var(--red)",     text: "var(--crust)", label: "MUST" },
  should: { bg: "var(--yellow)",  text: "var(--crust)", label: "SHOULD" },
  could:  { bg: "var(--blue)",    text: "var(--crust)", label: "COULD" },
  wont:   { bg: "var(--overlay0)", text: "var(--text-muted)", label: "WON'T" },
};

const PriorityControl: Component<Props> = (props) => {
  const style = () => PRIORITY_STYLES[props.value];

  function cycle() {
    if (!props.onChange) return;
    const order: Priority[] = ["must", "should", "could", "wont"];
    const idx = order.indexOf(props.value);
    const next = order[(idx + 1) % order.length];
    props.onChange(next);
  }

  return (
    <button
      onClick={cycle}
      title={`Priority: ${style().label} (click to cycle)`}
      style={{
        background: style().bg,
        color: style().text,
        border: "none",
        "border-radius": "3px",
        padding: "2px 8px",
        "font-size": "0.7em",
        "font-weight": "700",
        "letter-spacing": "0.05em",
        cursor: props.onChange ? "pointer" : "default",
        "text-transform": "uppercase",
      }}
    >
      {style().label}
    </button>
  );
};

export default PriorityControl;
