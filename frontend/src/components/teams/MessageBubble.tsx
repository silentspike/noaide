interface MessageBubbleProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number;
  color?: string;
  size?: number;
}

export default function MessageBubble(props: MessageBubbleProps) {
  const x = () => props.fromX + (props.toX - props.fromX) * props.progress;
  const y = () => props.fromY + (props.toY - props.fromY) * props.progress;
  const radius = () => props.size ?? 4;

  return (
    <circle
      cx={x()}
      cy={y()}
      r={radius()}
      fill={props.color ?? "var(--ctp-blue)"}
      opacity={Math.max(0, 1 - props.progress * 0.3)}
    >
      <animate
        attributeName="r"
        values={`${radius()};${radius() * 1.3};${radius()}`}
        dur="0.6s"
        repeatCount="indefinite"
      />
    </circle>
  );
}
