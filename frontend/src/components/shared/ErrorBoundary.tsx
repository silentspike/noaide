import { ErrorBoundary as SolidErrorBoundary, type JSX } from "solid-js";

interface PanelErrorBoundaryProps {
  name: string;
  children: JSX.Element;
}

/**
 * Panel-level error boundary — catches render errors in a panel
 * and shows a styled fallback instead of crashing the entire app.
 */
export default function PanelErrorBoundary(props: PanelErrorBoundaryProps) {
  return (
    <SolidErrorBoundary
      fallback={(err, reset) => (
        <div
          data-testid={`error-boundary-${props.name}`}
          style={{
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "center",
            gap: "12px",
            height: "100%",
            padding: "24px",
            color: "var(--ctp-red)",
            "text-align": "center",
          }}
        >
          <div style={{ "font-size": "24px" }}>&#x26A0;</div>
          <div style={{ "font-size": "13px", "font-weight": "600" }}>
            {props.name} crashed
          </div>
          <div
            style={{
              "font-size": "11px",
              color: "var(--ctp-subtext0)",
              "max-width": "300px",
              "word-break": "break-all",
            }}
          >
            {String(err)}
          </div>
          <button
            onClick={reset}
            style={{
              padding: "6px 16px",
              background: "var(--ctp-surface1)",
              color: "var(--ctp-text)",
              border: "none",
              "border-radius": "4px",
              cursor: "pointer",
              "font-size": "11px",
            }}
          >
            Retry
          </button>
        </div>
      )}
    >
      {props.children}
    </SolidErrorBoundary>
  );
}
