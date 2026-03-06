import { describe, it, expect } from "vitest";
import {
  statusColor,
  statusColorDark,
  formatSize,
  formatTime,
  shortUrl,
} from "./RequestRow";

describe("statusColor", () => {
  it("returns green for 2xx", () => {
    expect(statusColor(200)).toBe("#a6e3a1");
    expect(statusColor(201)).toBe("#a6e3a1");
    expect(statusColor(299)).toBe("#a6e3a1");
  });

  it("returns blue for 3xx", () => {
    expect(statusColor(301)).toBe("#89b4fa");
    expect(statusColor(304)).toBe("#89b4fa");
  });

  it("returns yellow for 4xx", () => {
    expect(statusColor(400)).toBe("#f9e2af");
    expect(statusColor(401)).toBe("#f9e2af");
    expect(statusColor(404)).toBe("#f9e2af");
  });

  it("returns red for 5xx", () => {
    expect(statusColor(500)).toBe("#f38ba8");
    expect(statusColor(503)).toBe("#f38ba8");
  });

  it("returns overlay for unknown codes", () => {
    expect(statusColor(0)).toBe("#a6adc8");
    expect(statusColor(100)).toBe("#a6adc8");
  });
});

describe("statusColorDark", () => {
  it("returns dark green for 2xx", () => {
    expect(statusColorDark(200)).toBe("#40a02b");
  });

  it("returns dark red for 5xx", () => {
    expect(statusColorDark(500)).toBe("#d20f39");
  });
});

describe("formatSize", () => {
  it("formats bytes", () => {
    expect(formatSize(0)).toBe("0B");
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(1023)).toBe("1023B");
  });

  it("formats kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0KB");
    expect(formatSize(1536)).toBe("1.5KB");
    expect(formatSize(55724)).toBe("54.4KB");
  });

  it("formats megabytes", () => {
    expect(formatSize(1048576)).toBe("1.0MB");
    expect(formatSize(5242880)).toBe("5.0MB");
  });
});

describe("formatTime", () => {
  it("formats timestamp as HH:MM:SS", () => {
    // 2026-03-06T10:30:45 UTC
    const ts = new Date("2026-03-06T10:30:45Z").getTime();
    const result = formatTime(ts);
    // We can't know the exact local time, but format should be HH:MM:SS
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("pads single digits", () => {
    // Midnight UTC
    const ts = new Date("2026-01-01T00:01:05Z").getTime();
    const result = formatTime(ts);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe("shortUrl", () => {
  it("extracts pathname from URL", () => {
    expect(shortUrl("https://api.anthropic.com/v1/messages")).toBe(
      "/v1/messages",
    );
  });

  it("handles tunnel protocol", () => {
    expect(shortUrl("tunnel://api.anthropic.com:443")).toBe(
      "api.anthropic.com:443",
    );
  });

  it("returns raw string for invalid URL", () => {
    expect(shortUrl("not-a-url")).toBe("not-a-url");
  });

  it("extracts pathname only (no query params)", () => {
    // shortUrl uses URL.pathname which strips query params
    expect(
      shortUrl("https://chatgpt.com/backend-api/codex/responses?foo=bar"),
    ).toBe("/backend-api/codex/responses");
  });
});
