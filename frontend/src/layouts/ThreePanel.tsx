import { createSignal, onMount, onCleanup, type JSX } from "solid-js";

interface ThreePanelProps {
  left: JSX.Element;
  center: JSX.Element;
  right: JSX.Element;
}

const MIN_PANEL_WIDTH = 200;
const HANDLE_WIDTH = 4;
const STORAGE_KEY = "noaide-panel-sizes";

function loadSizes(): [number, number] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return [parsed[0], parsed[1]];
    }
  } catch {
    // ignore
  }
  return [280, 320];
}

function saveSizes(left: number, right: number) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([left, right]));
}

export default function ThreePanel(props: ThreePanelProps) {
  const [leftWidth, setLeftWidth] = createSignal(loadSizes()[0]);
  const [rightWidth, setRightWidth] = createSignal(loadSizes()[1]);
  const [leftCollapsed, setLeftCollapsed] = createSignal(false);
  const [rightCollapsed, setRightCollapsed] = createSignal(false);
  const [dragging, setDragging] = createSignal<"left" | "right" | null>(null);

  let containerRef: HTMLDivElement | undefined;

  function onPointerDown(handle: "left" | "right", e: PointerEvent) {
    e.preventDefault();
    setDragging(handle);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onPointerMove(e: PointerEvent) {
    const d = dragging();
    if (!d || !containerRef) return;

    const rect = containerRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const totalWidth = rect.width;

    if (d === "left") {
      const max = totalWidth - rightWidth() - MIN_PANEL_WIDTH - HANDLE_WIDTH * 2;
      setLeftWidth(Math.max(MIN_PANEL_WIDTH, Math.min(x, max)));
      setLeftCollapsed(false);
    } else {
      const max =
        totalWidth - leftWidth() - MIN_PANEL_WIDTH - HANDLE_WIDTH * 2;
      setRightWidth(
        Math.max(MIN_PANEL_WIDTH, Math.min(totalWidth - x, max)),
      );
      setRightCollapsed(false);
    }
  }

  function onPointerUp() {
    if (dragging()) {
      setDragging(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      saveSizes(leftWidth(), rightWidth());
    }
  }

  function onHandleDoubleClick(handle: "left" | "right") {
    if (handle === "left") {
      setLeftCollapsed(!leftCollapsed());
    } else {
      setRightCollapsed(!rightCollapsed());
    }
  }

  onMount(() => {
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  });

  onCleanup(() => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  });

  const leftW = () => (leftCollapsed() ? 0 : leftWidth());
  const rightW = () => (rightCollapsed() ? 0 : rightWidth());

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        height: "100%",
        overflow: "hidden",
        background: "var(--ctp-base)",
      }}
    >
      <div
        style={{
          width: `${leftW()}px`,
          "min-width": leftCollapsed() ? "0" : `${MIN_PANEL_WIDTH}px`,
          overflow: "hidden auto",
          background: "var(--ctp-mantle)",
          "border-right": "1px solid var(--ctp-surface0)",
          transition: dragging() ? "none" : "width 0.2s ease",
        }}
      >
        {props.left}
      </div>

      <div
        style={{
          width: `${HANDLE_WIDTH}px`,
          cursor: "col-resize",
          background:
            dragging() === "left" ? "var(--ctp-blue)" : "transparent",
          "flex-shrink": "0",
          "z-index": "10",
        }}
        onPointerDown={(e) => onPointerDown("left", e)}
        onDblClick={() => onHandleDoubleClick("left")}
      />

      <div
        style={{
          flex: "1",
          "min-width": `${MIN_PANEL_WIDTH}px`,
          overflow: "hidden",
          background: "var(--ctp-base)",
        }}
      >
        {props.center}
      </div>

      <div
        style={{
          width: `${HANDLE_WIDTH}px`,
          cursor: "col-resize",
          background:
            dragging() === "right" ? "var(--ctp-blue)" : "transparent",
          "flex-shrink": "0",
          "z-index": "10",
        }}
        onPointerDown={(e) => onPointerDown("right", e)}
        onDblClick={() => onHandleDoubleClick("right")}
      />

      <div
        style={{
          width: `${rightW()}px`,
          "min-width": rightCollapsed() ? "0" : `${MIN_PANEL_WIDTH}px`,
          overflow: "hidden auto",
          background: "var(--ctp-mantle)",
          "border-left": "1px solid var(--ctp-surface0)",
          transition: dragging() ? "none" : "width 0.2s ease",
        }}
      >
        {props.right}
      </div>
    </div>
  );
}
