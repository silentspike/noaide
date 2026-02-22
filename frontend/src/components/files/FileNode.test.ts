import { describe, it, expect } from "vitest";

// Re-implement extensionIcon for testing (same logic as FileNode)
function extensionIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const icons: Record<string, string> = {
    ts: "TS", tsx: "TX", js: "JS", jsx: "JX",
    rs: "RS", py: "PY", go: "GO", md: "MD",
    css: "CS", html: "HT", json: "{}", toml: "TM",
    yaml: "YM", yml: "YM", lock: "LK", sh: "SH",
  };
  return icons[ext] ?? "..";
}

describe("extensionIcon", () => {
  it("returns TS for .ts files", () => {
    expect(extensionIcon("main.ts")).toBe("TS");
  });

  it("returns TX for .tsx files", () => {
    expect(extensionIcon("App.tsx")).toBe("TX");
  });

  it("returns RS for .rs files", () => {
    expect(extensionIcon("lib.rs")).toBe("RS");
  });

  it("returns {} for .json files", () => {
    expect(extensionIcon("package.json")).toBe("{}");
  });

  it("returns YM for both .yaml and .yml", () => {
    expect(extensionIcon("config.yaml")).toBe("YM");
    expect(extensionIcon("ci.yml")).toBe("YM");
  });

  it("returns .. for unknown extensions", () => {
    expect(extensionIcon("image.png")).toBe("..");
  });

  it("returns .. for files without extension", () => {
    expect(extensionIcon("Makefile")).toBe("..");
  });

  it("handles case insensitively", () => {
    expect(extensionIcon("README.MD")).toBe("MD");
  });

  it("uses last extension for double-dotted files", () => {
    expect(extensionIcon("module.d.ts")).toBe("TS");
  });
});
