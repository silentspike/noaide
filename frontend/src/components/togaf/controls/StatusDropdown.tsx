import { type Component, For } from "solid-js";
import type { PlanStatus } from "../types/plan";

interface Props {
  value: PlanStatus;
  onChange?: (status: PlanStatus) => void;
  disabled?: boolean;
}

const STATUS_OPTIONS: { value: PlanStatus; label: string; color: string }[] = [
  { value: "Draft", label: "Draft", color: "var(--overlay0)" },
  { value: "In Progress", label: "In Progress", color: "var(--blue)" },
  { value: "Review", label: "Review", color: "var(--yellow)" },
  { value: "Final", label: "Final", color: "var(--green)" },
];

const StatusDropdown: Component<Props> = (props) => {
  function handleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    props.onChange?.(target.value as PlanStatus);
  }

  const currentColor = () =>
    STATUS_OPTIONS.find((o) => o.value === props.value)?.color ?? "var(--text-primary)";

  return (
    <select
      value={props.value}
      onChange={handleChange}
      disabled={props.disabled}
      style={{
        background: "var(--bg-primary)",
        color: currentColor(),
        border: `1px solid ${currentColor()}`,
        "border-radius": "var(--radius)",
        padding: "4px 8px",
        "font-size": "0.85em",
        "font-weight": "600",
        cursor: props.disabled ? "not-allowed" : "pointer",
      }}
    >
      <For each={STATUS_OPTIONS}>
        {(opt) => <option value={opt.value}>{opt.label}</option>}
      </For>
    </select>
  );
};

export default StatusDropdown;
