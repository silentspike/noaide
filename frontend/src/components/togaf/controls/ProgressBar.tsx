import { type Component } from "solid-js";

interface Props {
  /** Number of completed items */
  done: number;
  /** Total number of items */
  total: number;
  /** Optional label (default: "Progress") */
  label?: string;
  /** Show fraction text (default: true) */
  showFraction?: boolean;
}

const ProgressBar: Component<Props> = (props) => {
  const pct = () =>
    props.total > 0 ? Math.round((props.done / props.total) * 100) : 0;

  const color = () => {
    const p = pct();
    if (p >= 100) return "var(--green)";
    if (p >= 75) return "var(--teal)";
    if (p >= 50) return "var(--blue)";
    if (p >= 25) return "var(--yellow)";
    return "var(--peach)";
  };

  return (
    <div style={{
      display: "flex",
      "align-items": "center",
      gap: "8px",
    }}>
      {props.label && (
        <span style={{
          "font-size": "0.85em",
          color: "var(--text-muted)",
        }}>
          {props.label}
        </span>
      )}
      <div style={{
        flex: "1",
        height: "8px",
        background: "var(--surface0)",
        "border-radius": "4px",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${pct()}%`,
          height: "100%",
          background: color(),
          "border-radius": "4px",
          transition: "width 0.3s ease",
        }} />
      </div>
      {(props.showFraction !== false) && (
        <span style={{
          "font-size": "0.85em",
          color: "var(--text-secondary)",
          "min-width": "48px",
          "text-align": "right",
        }}>
          {props.done}/{props.total}
        </span>
      )}
    </div>
  );
};

export default ProgressBar;
