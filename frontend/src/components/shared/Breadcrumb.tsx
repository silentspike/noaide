import { For, Show } from "solid-js";

interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

/**
 * Breadcrumb navigation — shows current location in the app hierarchy.
 * Last item is the current page (no click handler, bold).
 */
export default function Breadcrumb(props: BreadcrumbProps) {
  return (
    <nav
      data-testid="breadcrumb"
      aria-label="Breadcrumb navigation"
      style={{
        display: "flex",
        "align-items": "center",
        gap: "4px",
        "font-size": "11px",
        "font-family": "var(--font-mono)",
        color: "var(--ctp-overlay0)",
        padding: "4px 12px",
        overflow: "hidden",
        "white-space": "nowrap",
      }}
    >
      <For each={props.items}>
        {(item, index) => {
          const isLast = () => index() === props.items.length - 1;
          return (
            <>
              <Show when={index() > 0}>
                <span style={{ opacity: "0.4" }} aria-hidden="true">/</span>
              </Show>
              <Show
                when={!isLast() && item.onClick}
                fallback={
                  <span
                    style={{
                      color: isLast() ? "var(--ctp-text)" : "var(--ctp-overlay0)",
                      "font-weight": isLast() ? "600" : "400",
                    }}
                    aria-current={isLast() ? "page" : undefined}
                  >
                    {item.label}
                  </span>
                }
              >
                <button
                  onClick={item.onClick}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--ctp-blue)",
                    cursor: "pointer",
                    padding: "0",
                    "font-size": "inherit",
                    "font-family": "inherit",
                    "text-decoration": "none",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = "underline"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = "none"; }}
                >
                  {item.label}
                </button>
              </Show>
            </>
          );
        }}
      </For>
    </nav>
  );
}
