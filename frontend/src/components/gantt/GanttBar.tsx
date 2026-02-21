interface GanttBarProps {
  x: number;
  width: number;
  y: number;
  height: number;
  color: string;
  label: string;
  owner?: string;
}

export default function GanttBar(props: GanttBarProps) {
  return (
    <g>
      <rect
        x={props.x}
        y={props.y}
        width={Math.max(4, props.width)}
        height={props.height}
        rx="3"
        fill={props.color}
        opacity="0.85"
      >
        <title>{props.label}{props.owner ? ` (${props.owner})` : ""}</title>
      </rect>
      {props.width > 40 && (
        <text
          x={props.x + 4}
          y={props.y + props.height / 2 + 3}
          fill="var(--ctp-crust)"
          font-size="9"
          font-family="var(--font-mono)"
          font-weight="600"
        >
          {props.label.length > Math.floor(props.width / 6) ? props.label.slice(0, Math.floor(props.width / 6)) + ".." : props.label}
        </text>
      )}
    </g>
  );
}
