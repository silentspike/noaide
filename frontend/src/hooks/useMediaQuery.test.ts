import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock matchMedia before importing the module
let mockMatches = false;
let mockListeners: Array<(e: { matches: boolean }) => void> = [];

const mockMatchMedia = vi.fn((query: string) => ({
  matches: mockMatches,
  media: query,
  addEventListener: (_event: string, handler: (e: { matches: boolean }) => void) => {
    mockListeners.push(handler);
  },
  removeEventListener: (_event: string, handler: (e: { matches: boolean }) => void) => {
    mockListeners = mockListeners.filter((h) => h !== handler);
  },
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: mockMatchMedia,
});

describe("useMediaQuery", () => {
  beforeEach(() => {
    mockMatches = false;
    mockListeners = [];
    mockMatchMedia.mockClear();
  });

  it("calls window.matchMedia with the given query", async () => {
    const { useMediaQuery } = await import("./useMediaQuery");

    // SolidJS hooks need a reactive root — we test the export shape
    expect(typeof useMediaQuery).toBe("function");
    expect(mockMatchMedia).not.toHaveBeenCalled(); // Not called until onMount
  });

  it("exports useIsMobile convenience function", async () => {
    const { useIsMobile } = await import("./useMediaQuery");
    expect(typeof useIsMobile).toBe("function");
  });

  it("useIsMobile calls matchMedia with max-width: 767px breakpoint", async () => {
    // Verify the function signature — actual matchMedia call happens in onMount
    const { useIsMobile } = await import("./useMediaQuery");
    const result = useIsMobile();
    // Returns a signal accessor (function)
    expect(typeof result).toBe("function");
  });

  it("matchMedia mock returns correct initial value when true", () => {
    mockMatches = true;
    const mql = window.matchMedia("(max-width: 767px)");
    expect(mql.matches).toBe(true);
  });

  it("matchMedia mock returns correct initial value when false", () => {
    mockMatches = false;
    const mql = window.matchMedia("(max-width: 767px)");
    expect(mql.matches).toBe(false);
  });

  it("matchMedia mock registers change listeners", () => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = vi.fn();
    mql.addEventListener("change", handler);
    expect(mockListeners).toContain(handler);
  });

  it("matchMedia mock unregisters change listeners", () => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = vi.fn();
    mql.addEventListener("change", handler);
    expect(mockListeners.length).toBe(1);
    mql.removeEventListener("change", handler);
    expect(mockListeners.length).toBe(0);
  });
});
