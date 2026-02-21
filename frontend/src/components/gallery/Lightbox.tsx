import { createSignal, Show, onMount, onCleanup } from "solid-js";
import type { GalleryImage } from "./GalleryPanel";

export default function Lightbox(props: {
  images: GalleryImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = createSignal(props.initialIndex);
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });

  const current = () => props.images[index()];

  const prev = () => setIndex((i) => (i > 0 ? i - 1 : props.images.length - 1));
  const next = () => setIndex((i) => (i < props.images.length - 1 ? i + 1 : 0));

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
    else if (e.key === "ArrowLeft") { prev(); resetView(); }
    else if (e.key === "ArrowRight") { next(); resetView(); }
    else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z * 1.5, 5));
    else if (e.key === "-") setZoom((z) => Math.max(z / 1.5, 0.5));
    else if (e.key === "0") resetView();
  };

  onMount(() => document.addEventListener("keydown", handleKey));
  onCleanup(() => document.removeEventListener("keydown", handleKey));

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.5, Math.min(5, z * delta)));
  };

  const download = () => {
    const img = current();
    if (!img) return;
    const a = document.createElement("a");
    a.href = img.src;
    a.download = img.alt || "image";
    a.click();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        "z-index": "2000",
        background: "rgba(0, 0, 0, 0.9)",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
      }}
      onClick={props.onClose}
    >
      {/* Toolbar */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          display: "flex",
          gap: "8px",
          "z-index": "2001",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setZoom((z) => Math.min(z * 1.5, 5))}
          style={toolbarBtnStyle()}
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z / 1.5, 0.5))}
          style={toolbarBtnStyle()}
        >
          -
        </button>
        <button onClick={resetView} style={toolbarBtnStyle()}>
          1:1
        </button>
        <button onClick={download} style={toolbarBtnStyle()}>
          DL
        </button>
        <button onClick={props.onClose} style={toolbarBtnStyle()}>
          X
        </button>
      </div>

      {/* Navigation */}
      <Show when={props.images.length > 1}>
        <button
          style={{
            ...navBtnStyle(),
            left: "16px",
          }}
          onClick={(e) => { e.stopPropagation(); prev(); resetView(); }}
        >
          &lt;
        </button>
        <button
          style={{
            ...navBtnStyle(),
            right: "16px",
          }}
          onClick={(e) => { e.stopPropagation(); next(); resetView(); }}
        >
          &gt;
        </button>
      </Show>

      {/* Image */}
      <Show when={current()}>
        <img
          src={current()!.src}
          alt={current()!.alt}
          style={{
            "max-width": "90vw",
            "max-height": "85vh",
            "object-fit": "contain",
            transform: `scale(${zoom()}) translate(${pan().x}px, ${pan().y}px)`,
            transition: "transform 0.1s ease-out",
            cursor: zoom() > 1 ? "grab" : "zoom-in",
          }}
          onClick={(e) => e.stopPropagation()}
          onWheel={handleWheel}
        />
      </Show>

      {/* Counter */}
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          color: "var(--ctp-overlay1)",
          "font-size": "13px",
        }}
      >
        {index() + 1} / {props.images.length}
      </div>
    </div>
  );
}

function toolbarBtnStyle() {
  return {
    padding: "6px 12px",
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    "border-radius": "4px",
    color: "#fff",
    cursor: "pointer",
    "font-size": "13px",
  };
}

function navBtnStyle() {
  return {
    position: "absolute" as const,
    top: "50%",
    transform: "translateY(-50%)",
    "z-index": "2001",
    padding: "12px 16px",
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    "border-radius": "50%",
    color: "#fff",
    cursor: "pointer",
    "font-size": "18px",
  };
}
