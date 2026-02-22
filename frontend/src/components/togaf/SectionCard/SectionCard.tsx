import { type Component, createSignal, Show, createMemo } from "solid-js";
import type { SectionData, SectionStatus, Priority, SectionId } from "../types/plan";
import { SECTION_DEFS, SECTION_TO_PHASE } from "../types/togafPhases";

interface Props {
  /** Section ID (e.g., "p1", "a3", "e4") */
  sectionId: SectionId;
  /** Section data from the plan store */
  data: SectionData;
  /** Called when status changes */
  onStatusChange?: (id: SectionId, status: SectionStatus) => void;
}

const STATUS_STYLES: Record<SectionStatus, { bg: string; text: string; label: string }> = {
  pending:     { bg: "var(--surface1)", text: "var(--text-muted)",    label: "Pending" },
  in_progress: { bg: "var(--blue)",     text: "var(--crust)",         label: "In Progress" },
  done:        { bg: "var(--green)",    text: "var(--crust)",         label: "Done" },
  skipped:     { bg: "var(--overlay0)", text: "var(--text-muted)",    label: "Skipped" },
};

const PRIORITY_COLORS: Record<Priority, string> = {
  must:   "var(--red)",
  should: "var(--yellow)",
  could:  "var(--blue)",
  wont:   "var(--overlay0)",
};

const SectionCard: Component<Props> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const sectionDef = createMemo(() => SECTION_DEFS.get(props.sectionId));
  const phase = createMemo(() => SECTION_TO_PHASE.get(props.sectionId));
  const statusStyle = createMemo(() => STATUS_STYLES[props.data.status]);

  const sectionLabel = createMemo(() => {
    const def = sectionDef();
    const id = props.sectionId.toUpperCase().replace(/(\d)/, ".$1");
    return def ? `${id} ${def.name}` : id;
  });

  function cycleStatus() {
    if (!props.onStatusChange) return;
    const order: SectionStatus[] = ["pending", "in_progress", "done", "skipped"];
    const idx = order.indexOf(props.data.status);
    const next = order[(idx + 1) % order.length];
    props.onStatusChange(props.sectionId, next);
  }

  return (
    <div style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      "border-left": `4px solid ${phase()?.color ? `var(--${phase()!.color})` : "var(--overlay0)"}`,
      "border-radius": "var(--radius)",
      "margin-bottom": "4px",
      overflow: "hidden",
    }}>
      {/* Header (always visible) */}
      <div
        onClick={() => setExpanded(!expanded())}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          "user-select": "none",
        }}
      >
        {/* Expand/Collapse arrow */}
        <span style={{
          color: "var(--text-muted)",
          "font-size": "0.85em",
          transform: expanded() ? "rotate(90deg)" : "none",
          transition: "transform 0.15s ease",
          "min-width": "12px",
        }}>
          &#9654;
        </span>

        {/* Section label */}
        <span style={{
          flex: "1",
          "font-weight": "600",
          "font-size": "0.9em",
          color: "var(--text-primary)",
        }}>
          {sectionLabel()}
        </span>

        {/* Priority badge */}
        <span style={{
          "font-size": "0.65em",
          "font-weight": "700",
          color: PRIORITY_COLORS[props.data.priority],
          "text-transform": "uppercase",
          "letter-spacing": "0.05em",
        }}>
          {props.data.priority}
        </span>

        {/* Status badge */}
        <button
          onClick={(e) => { e.stopPropagation(); cycleStatus(); }}
          style={{
            background: statusStyle().bg,
            color: statusStyle().text,
            border: "none",
            "border-radius": "3px",
            padding: "2px 8px",
            "font-size": "0.7em",
            "font-weight": "600",
            cursor: props.onStatusChange ? "pointer" : "default",
          }}
        >
          {statusStyle().label}
        </button>
      </div>

      {/* Collapsible content */}
      <Show when={expanded()}>
        <div style={{
          padding: "0 12px 12px 32px",
          "font-size": "0.85em",
          color: "var(--text-secondary)",
          "line-height": "1.5",
          "border-top": "1px solid var(--border)",
          "max-height": "400px",
          overflow: "auto",
        }}>
          <Show
            when={props.data.html}
            fallback={
              <p style={{ color: "var(--overlay0)", "font-style": "italic" }}>
                No content available.
              </p>
            }
          >
            {/* Inject pre-rendered HTML from parser */}
            <div innerHTML={props.data.html!} />
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default SectionCard;
