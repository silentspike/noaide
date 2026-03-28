import { Show, For } from "solid-js";
import ToolCardBase from "./ToolCardBase";
import type { ToolResultContent } from "../../types/messages";
import type { GalleryImage } from "../gallery/GalleryPanel";

interface ReadCardProps {
  filePath: string;
  content?: string;
  images?: ToolResultContent[];
  isError?: boolean;
  onImageClick?: (images: GalleryImage[], index: number) => void;
}

export default function ReadCard(props: ReadCardProps) {
  return (
    <ToolCardBase toolName="Read" isError={props.isError}>
      <div
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "11px",
          color: "var(--ctp-blue)",
          "margin-bottom": "6px",
        }}
      >
        {props.filePath}
      </div>

      {/* Render images from tool_result (e.g. Read on PNG/JPG/screenshot) */}
      <Show when={props.images && props.images.length > 0}>
        {(() => {
          const galleryImages = () =>
            (props.images ?? []).map((img, i) => ({
              id: `read-img-${i}`,
              src: `data:${img.source!.media_type};base64,${img.source!.data}`,
              alt: props.filePath,
              mediaType: img.source!.media_type,
            }));
          return (
            <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", margin: "6px 0" }}>
              <For each={props.images}>
                {(img, idx) => (
                  <div
                    style={{
                      "border-radius": "8px",
                      overflow: "hidden",
                      border: "1px solid var(--ctp-surface1)",
                      "max-width": "100%",
                      cursor: props.onImageClick ? "pointer" : "default",
                      transition: "border-color 200ms ease",
                    }}
                    onMouseEnter={(e) => { if (props.onImageClick) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--ctp-mauve)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--ctp-surface1)"; }}
                    onClick={() => props.onImageClick?.(galleryImages(), idx())}
                  >
                    <img
                      src={`data:${img.source!.media_type};base64,${img.source!.data}`}
                      alt={props.filePath}
                      style={{
                        "max-width": "100%",
                        "max-height": "400px",
                        "object-fit": "contain",
                        display: "block",
                      }}
                    />
                  </div>
                )}
              </For>
            </div>
          );
        })()}
      </Show>

      <Show when={props.content}>
        <pre
          style={{
            margin: "0",
            "font-family": "var(--font-mono)",
            "font-size": "11px",
            "line-height": "1.5",
            color: "var(--ctp-subtext0)",
            background: "var(--ctp-crust)",
            "border-radius": "6px",
            padding: "8px 10px",
            "max-height": "300px",
            overflow: "auto",
            "white-space": "pre-wrap",
            "word-break": "break-word",
          }}
        >
          {props.content}
        </pre>
      </Show>
    </ToolCardBase>
  );
}
