import { describe, it, expect } from "vitest";

// Re-implement helper functions from SessionCard for testing
function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function shortPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

describe("relativeTime", () => {
  it("returns 'just now' for recent timestamps", () => {
    expect(relativeTime(Date.now() - 5000)).toBe("just now");
  });

  it("returns minutes for timestamps within the hour", () => {
    expect(relativeTime(Date.now() - 5 * 60 * 1000)).toBe("5m ago");
  });

  it("returns hours for timestamps within the day", () => {
    expect(relativeTime(Date.now() - 3 * 60 * 60 * 1000)).toBe("3h ago");
  });

  it("returns days for older timestamps", () => {
    expect(relativeTime(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe("2d ago");
  });
});

describe("shortPath", () => {
  it("extracts last path segment", () => {
    expect(shortPath("/work/noaide/frontend")).toBe("frontend");
  });

  it("handles single segment", () => {
    expect(shortPath("project")).toBe("project");
  });

  it("handles trailing slash by returning empty string or path", () => {
    // split("/") on "/work/project/" gives ["", "work", "project", ""]
    // last element is "", so shortPath returns the full path
    expect(shortPath("/work/project/")).toBe("/work/project/");
  });

  it("handles deeply nested paths", () => {
    expect(shortPath("/a/b/c/d/e")).toBe("e");
  });
});
