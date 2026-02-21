import { createSignal, For, Show } from "solid-js";
import Lightbox from "./Lightbox";

export interface GalleryImage {
  id: string;
  src: string;
  alt: string;
  mediaType: string;
  sessionId?: string;
}

export default function GalleryPanel(props: { images?: GalleryImage[] }) {
  const [selectedIndex, setSelectedIndex] = createSignal<number | null>(null);

  const images = () => props.images ?? [];

  return (
    <div
      style={{
        padding: "12px",
        height: "100%",
        overflow: "auto",
        color: "var(--ctp-text)",
      }}
    >
      <h3
        style={{
          margin: "0 0 12px 0",
          "font-size": "14px",
          color: "var(--ctp-mauve)",
        }}
      >
        Gallery
      </h3>

      <Show
        when={images().length > 0}
        fallback={
          <div
            style={{
              "text-align": "center",
              color: "var(--ctp-overlay0)",
              "font-size": "13px",
              "padding-top": "40px",
            }}
          >
            No images found in sessions
          </div>
        }
      >
        <div
          style={{
            display: "grid",
            "grid-template-columns": "repeat(auto-fill, minmax(120px, 1fr))",
            gap: "8px",
          }}
        >
          <For each={images()}>
            {(img, index) => (
              <div
                style={{
                  "aspect-ratio": "1",
                  overflow: "hidden",
                  "border-radius": "6px",
                  border: "1px solid var(--ctp-surface1)",
                  cursor: "pointer",
                  transition: "border-color 0.2s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    "var(--ctp-mauve)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    "var(--ctp-surface1)";
                }}
                onClick={() => setSelectedIndex(index())}
              >
                <img
                  src={img.src}
                  alt={img.alt}
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: "100%",
                    "object-fit": "cover",
                  }}
                />
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={selectedIndex() !== null}>
        <Lightbox
          images={images()}
          initialIndex={selectedIndex()!}
          onClose={() => setSelectedIndex(null)}
        />
      </Show>
    </div>
  );
}
