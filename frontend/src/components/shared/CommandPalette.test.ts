import { describe, it, expect } from "vitest";

// Re-implement fuzzyMatch for unit testing (same logic as CommandPalette)
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

describe("fuzzyMatch", () => {
  it("matches exact string", () => {
    expect(fuzzyMatch("hello", "hello")).toBe(true);
  });

  it("matches prefix", () => {
    expect(fuzzyMatch("hel", "hello world")).toBe(true);
  });

  it("matches fuzzy subsequence", () => {
    expect(fuzzyMatch("hlo", "hello")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(fuzzyMatch("HEL", "hello")).toBe(true);
  });

  it("returns true for empty query", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
  });

  it("returns false when query longer than text", () => {
    expect(fuzzyMatch("hello world", "hello")).toBe(false);
  });

  it("returns false for non-matching characters", () => {
    expect(fuzzyMatch("xyz", "hello")).toBe(false);
  });

  it("matches interleaved characters", () => {
    expect(fuzzyMatch("cmd", "CommandPalette")).toBe(true);
  });

  it("does not match reversed order", () => {
    expect(fuzzyMatch("leh", "hello")).toBe(false);
  });
});
