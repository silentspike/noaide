import { render, fireEvent, screen, waitFor, cleanup } from "@solidjs/testing-library";
import { createStore } from "solid-js/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InjectPanel from "./InjectPanel";

const [sessionState, setSessionState] = createStore({
  httpApiUrl: "http://localhost:8080",
  activeSessionId: "session-a" as string | null,
  connectionStatus: "connected" as "connecting" | "connected" | "disconnected",
});

vi.mock("../../App", () => ({
  useSession: () => ({
    state: sessionState,
  }),
}));

describe("InjectPanel", () => {
  beforeEach(() => {
    setSessionState("httpApiUrl", "http://localhost:8080");
    setSessionState("activeSessionId", "session-a");
    setSessionState("connectionStatus", "connected");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("reloads injection config when the active session changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (!init?.method || init.method === "GET") {
        if (url.endsWith("/session-a")) {
          return new Response(
            JSON.stringify({
              presets: ["anti_laziness", "noaide_context"],
              custom_text: "Session A custom",
            }),
            { status: 200 },
          );
        }

        if (url.endsWith("/session-b")) {
          return new Response(
            JSON.stringify({
              presets: ["speed"],
              custom_text: "Session B custom",
            }),
            { status: 200 },
          );
        }
      }

      return new Response(null, { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(() => <InjectPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("inject-preset-anti_laziness").getAttribute("aria-pressed")).toBe("true");
      expect((screen.getByTestId("inject-custom-text") as HTMLTextAreaElement).value).toBe("Session A custom");
    });

    setSessionState("activeSessionId", "session-b");

    await waitFor(() => {
      expect(screen.getByTestId("inject-preset-anti_laziness").getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByTestId("inject-preset-speed").getAttribute("aria-pressed")).toBe("true");
      expect((screen.getByTestId("inject-custom-text") as HTMLTextAreaElement).value).toBe("Session B custom");
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/proxy/inject/session-a",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/proxy/inject/session-b",
    );
  });

  it("persists the next preset selection when Anti-Laziness is toggled", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (!init?.method || init.method === "GET") {
        expect(url).toBe("http://localhost:8080/api/proxy/inject/session-a");
        return new Response(
          JSON.stringify({
            presets: ["noaide_context"],
            custom_text: "",
          }),
          { status: 200 },
        );
      }

      return new Response(null, { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(() => <InjectPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("inject-preset-noaide_context").getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByTestId("inject-preset-anti_laziness").getAttribute("aria-pressed")).toBe("false");
    });

    fireEvent.click(screen.getByTestId("inject-preset-anti_laziness"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const saveCall = fetchMock.mock.calls[1];
    expect(saveCall[0]).toBe("http://localhost:8080/api/proxy/inject/session-a");
    expect(saveCall[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presets: ["noaide_context", "anti_laziness"],
        custom_text: null,
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("inject-preset-anti_laziness").getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByTestId("inject-save-state").textContent).toContain("Saved");
    });
  });

  it("reloads and clears stale inject state when the backend reconnects fresh", async () => {
    let fetchCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe("http://localhost:8080/api/proxy/inject/session-a");
      fetchCount += 1;

      if (fetchCount === 1) {
        return new Response(
          JSON.stringify({
            presets: ["anti_laziness", "noaide_context"],
            custom_text: "Old backend state",
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          presets: ["noaide_context"],
          custom_text: null,
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    render(() => <InjectPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("inject-preset-anti_laziness").getAttribute("aria-pressed")).toBe("true");
      expect((screen.getByTestId("inject-custom-text") as HTMLTextAreaElement).value).toBe("Old backend state");
    });

    setSessionState("connectionStatus", "disconnected");
    setSessionState("connectionStatus", "connected");

    await waitFor(() => {
      expect(screen.getByTestId("inject-preset-anti_laziness").getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByTestId("inject-preset-noaide_context").getAttribute("aria-pressed")).toBe("true");
      expect((screen.getByTestId("inject-custom-text") as HTMLTextAreaElement).value).toBe("");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
