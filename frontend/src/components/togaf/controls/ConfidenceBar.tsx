import { type Component } from "solid-js";

interface Props {
  /** Confidence percentage 0-100 */
  value: number;
  /** Optional label override */
  label?: string;
}

function confidenceColor(value: number): string {
  if (value >= 80) return "var(--green)";
  if (value >= 60) return "var(--yellow)";
  if (value >= 40) return "var(--peach)";
  return "var(--red)";
}

const ConfidenceBar: Component<Props> = (props) => {
  return (
    <div style={{
      display: "flex",
      "align-items": "center",
      gap: "8px",
    }}>
      <span style={{
        "font-size": "0.85em",
        color: "var(--text-muted)",
      }}>
        {props.label ?? "Confidence"}
      </span>
      <div style={{
        flex: "1",
        height: "6px",
        background: "var(--surface0)",
        "border-radius": "3px",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, props.value))}%`,
          height: "100%",
          background: confidenceColor(props.value),
          "border-radius": "3px",
          transition: "width 0.3s ease",
        }} />
      </div>
      <span style={{
        "font-size": "0.85em",
        "font-weight": "bold",
        color: confidenceColor(props.value),
        "min-width": "36px",
        "text-align": "right",
      }}>
        {props.value}%
      </span>
    </div>
  );
};

export default ConfidenceBar;
