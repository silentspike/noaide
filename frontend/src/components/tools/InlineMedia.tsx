import { For, Show, Switch, Match } from "solid-js";
import type { DetectedMedia } from "../../lib/media-detect";
import type { GalleryImage } from "../gallery/GalleryPanel";

export default function InlineMedia(props: {
  media: DetectedMedia[];
  apiBase: string;
  onImageClick?: (images: GalleryImage[], index: number) => void;
}) {
  const mediaUrl = (path: string) =>
    `${props.apiBase}/api/files?path=${encodeURIComponent(path)}`;

  const imageMedia = () => props.media.filter((m) => m.type === "image");
  const galleryImages = () =>
    imageMedia().map((m, i) => ({
      id: `media-${i}`,
      src: mediaUrl(m.path),
      alt: m.path.split("/").pop() ?? "Image",
      mediaType: m.mime,
    }));

  return (
    <Show when={props.media.length > 0}>
      <div
        style={{
          display: "flex",
          "flex-wrap": "wrap",
          gap: "8px",
          margin: "6px 0",
        }}
      >
        <For each={props.media}>
          {(m) => (
            <Switch>
              <Match when={m.type === "image"}>
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
                  onClick={() => {
                    if (!props.onImageClick) return;
                    const imgIdx = imageMedia().findIndex((im) => im.path === m.path);
                    props.onImageClick(galleryImages(), imgIdx >= 0 ? imgIdx : 0);
                  }}
                >
                  <img
                    src={mediaUrl(m.path)}
                    alt={m.path.split("/").pop()}
                    style={{
                      "max-width": "100%",
                      "max-height": "400px",
                      "object-fit": "contain",
                      display: "block",
                    }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </div>
              </Match>
              <Match when={m.type === "video"}>
                <video
                  controls
                  src={mediaUrl(m.path)}
                  style={{
                    "max-width": "100%",
                    "max-height": "400px",
                    "border-radius": "8px",
                    border: "1px solid var(--ctp-surface1)",
                  }}
                />
              </Match>
              <Match when={m.type === "audio"}>
                <audio
                  controls
                  src={mediaUrl(m.path)}
                  style={{ width: "100%", "border-radius": "8px" }}
                />
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </Show>
  );
}
