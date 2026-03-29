export interface DetectedMedia {
  path: string;
  type: "image" | "video" | "audio";
  mime: string;
}

const MEDIA_EXT: Record<string, { type: "image" | "video" | "audio"; mime: string }> = {
  ".png": { type: "image", mime: "image/png" },
  ".jpg": { type: "image", mime: "image/jpeg" },
  ".jpeg": { type: "image", mime: "image/jpeg" },
  ".gif": { type: "image", mime: "image/gif" },
  ".svg": { type: "image", mime: "image/svg+xml" },
  ".webp": { type: "image", mime: "image/webp" },
  ".bmp": { type: "image", mime: "image/bmp" },
  ".avif": { type: "image", mime: "image/avif" },
  ".mp4": { type: "video", mime: "video/mp4" },
  ".webm": { type: "video", mime: "video/webm" },
  ".mp3": { type: "audio", mime: "audio/mpeg" },
  ".wav": { type: "audio", mime: "audio/wav" },
  ".ogg": { type: "audio", mime: "audio/ogg" },
  ".m4a": { type: "audio", mime: "audio/mp4" },
};

const MEDIA_PATH_RE =
  /(?:^|[\s"'=])(\/[\w./-]+\.(?:png|jpg|jpeg|gif|svg|webp|bmp|avif|mp4|webm|mp3|wav|ogg|m4a))\b/gi;

function getMediaInfo(filePath: string): DetectedMedia | null {
  const lower = filePath.toLowerCase();
  for (const [ext, info] of Object.entries(MEDIA_EXT)) {
    if (lower.endsWith(ext)) {
      return { path: filePath, type: info.type, mime: info.mime };
    }
  }
  return null;
}

/** Detect media file paths in tool input/output */
export function detectMedia(
  toolName: string,
  input: Record<string, unknown> | undefined,
  output: string,
): DetectedMedia[] {
  const seen = new Set<string>();
  const results: DetectedMedia[] = [];

  const add = (path: string) => {
    if (seen.has(path)) return;
    const info = getMediaInfo(path);
    if (info) {
      seen.add(path);
      results.push(info);
    }
  };

  // Write tool: check input.file_path directly
  if (toolName === "Write" && typeof input?.file_path === "string") {
    add(input.file_path as string);
  }

  // Bash tool: scan command + output for absolute paths
  if (toolName === "Bash" && typeof input?.command === "string") {
    for (const match of (input.command as string).matchAll(MEDIA_PATH_RE)) {
      add(match[1]);
    }
  }

  // Scan output for media paths (works for all tools)
  if (output) {
    for (const match of output.matchAll(MEDIA_PATH_RE)) {
      add(match[1]);
    }
  }

  return results;
}
