import ToolCardBase from "./ToolCardBase";

interface PermissionCardProps {
  tool: string;
  description: string;
  approved?: boolean;
  isError?: boolean;
}

export default function PermissionCard(props: PermissionCardProps) {
  return (
    <ToolCardBase toolName="Permission" isError={props.isError}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "font-size": "11px",
        }}
      >
        <span
          style={{
            padding: "1px 6px",
            "border-radius": "4px",
            background:
              props.approved === true
                ? "rgba(166, 227, 161, 0.15)"
                : props.approved === false
                  ? "rgba(243, 139, 168, 0.15)"
                  : "rgba(249, 226, 175, 0.15)",
            color:
              props.approved === true
                ? "var(--ctp-green)"
                : props.approved === false
                  ? "var(--ctp-red)"
                  : "var(--ctp-yellow)",
            "font-weight": "600",
            "font-size": "10px",
          }}
        >
          {props.approved === true
            ? "Approved"
            : props.approved === false
              ? "Denied"
              : "Pending"}
        </span>
        <span
          style={{
            "font-family": "var(--font-mono)",
            color: "var(--ctp-blue)",
          }}
        >
          {props.tool}
        </span>
      </div>
      <div
        style={{
          "margin-top": "6px",
          "font-size": "11px",
          color: "var(--ctp-subtext0)",
          "line-height": "1.4",
        }}
      >
        {props.description}
      </div>
    </ToolCardBase>
  );
}
