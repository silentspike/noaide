import { createSignal, createMemo, For, Show } from "solid-js";
import { useSession } from "../../App";
import type { Session } from "../../stores/session";
import type { OrbState } from "../../types/messages";
import SessionCard from "./SessionCard";
import SessionStatus from "./SessionStatus";
import ThemeSlider from "./ThemeSlider";
import FontSlider from "./FontSlider";

function sessionSortKey(s: Session): number {
  switch (s.status) {
    case "active":
      return 0;
    case "idle":
      return 1;
    case "error":
      return 2;
    case "archived":
      return 3;
    default:
      return 4;
  }
}

function orbStateForSession(session: Session): OrbState {
  switch (session.status) {
    case "active":
      return "streaming";
    case "idle":
      return "idle";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

/** Inline SVG logos for the three CLI tools. */
function ClaudeLogo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M16.009 8.06l-3.39 8.56a.6.6 0 01-.55.38h-.14a.6.6 0 01-.55-.38L8.62 9.32a.12.12 0 00-.22 0L6.38 14.5a.6.6 0 01-.55.38h-.06a.6.6 0 01-.55-.78l2.8-8.56a.6.6 0 01.55-.38h.18a.6.6 0 01.55.38l2.81 7.44a.12.12 0 00.22 0l2.1-5.28a.6.6 0 01.55-.38h.06a.6.6 0 01.55.78l-.6 0z"
        fill="#d4a373"
      />
      <circle cx="12" cy="12" r="11" stroke="#d4a373" stroke-width="1.5" fill="none" />
    </svg>
  );
}

function CodexLogo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.18L18.36 7.5 12 10.82 5.64 7.5 12 4.18zM5 9.06l6 3.33v6.55l-6-3.33V9.06zm8 9.88v-6.55l6-3.33v6.55l-6 3.33z"
        fill="#10a37f"
      />
    </svg>
  );
}

function GeminiLogo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M12 2C12 2 12 8.5 8 12C12 12 12 12 12 22C12 22 12 15.5 16 12C12 12 12 12 12 2Z"
        fill="#4285f4"
      />
      <path
        d="M12 2C12 2 12 8.5 16 12C12 12 12 12 12 22C12 22 12 15.5 8 12C12 12 12 12 12 2Z"
        fill="#669df6"
        opacity="0.6"
      />
    </svg>
  );
}

type CliType = "claude" | "codex" | "gemini";

const CLI_OPTIONS: { type: CliType; label: string; desc: string; color: string; Logo: () => ReturnType<typeof ClaudeLogo> }[] = [
  { type: "claude", label: "Claude", desc: "Anthropic", color: "#d4a373", Logo: ClaudeLogo },
  { type: "codex", label: "Codex", desc: "OpenAI", color: "#10a37f", Logo: CodexLogo },
  { type: "gemini", label: "Gemini", desc: "Google", color: "#4285f4", Logo: GeminiLogo },
];

export default function SessionList() {
  const store = useSession();
  const [filter, setFilter] = createSignal("");
  const [showCliPicker, setShowCliPicker] = createSignal(false);
  const [spawning, setSpawning] = createSignal(false);

  async function spawnSession(cliType: CliType) {
    const base = store.state.httpApiUrl;
    if (!base || spawning()) return;
    setSpawning(true);
    try {
      const res = await fetch(`${base}/api/sessions/managed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_dir: "/work/noaide", cli_type: cliType }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.sessionId) {
          await store.fetchSessions();
          store.setActiveSession(data.sessionId);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setSpawning(false);
      setShowCliPicker(false);
    }
  }

  const sortedSessions = createMemo(() => {
    const query = filter().toLowerCase();
    return [...store.state.sessions]
      .filter(
        (s) =>
          !query ||
          s.path.toLowerCase().includes(query) ||
          (s.model ?? "").toLowerCase().includes(query) ||
          s.id.toLowerCase().includes(query) ||
          (s.cliType ?? "").toLowerCase().includes(query),
      )
      .sort((a, b) => {
        const sa = sessionSortKey(a);
        const sb = sessionSortKey(b);
        if (sa !== sb) return sa - sb;
        return b.startedAt - a.startedAt;
      });
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
      }}
    >
      {/* Header */}
      <div style={{ padding: "16px 16px 8px" }}>
        <h2
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "10px",
            "font-weight": "700",
            color: "var(--neon-green, #00ff9d)",
            "text-transform": "uppercase",
            "letter-spacing": "0.15em",
            margin: "0 0 12px",
          }}
        >
          Sessions
        </h2>

        {/* Theme Slider */}
        <ThemeSlider />

        {/* Font Slider */}
        <FontSlider />

        {/* Search filter */}
        <input
          data-testid="session-filter"
          type="text"
          placeholder="Filter sessions..."
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          style={{
            width: "100%",
            padding: "7px 12px",
            background: "var(--ctp-base)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "6px",
            color: "var(--ctp-text)",
            "font-size": "12px",
            "font-family": "var(--font-mono)",
            outline: "none",
            "box-sizing": "border-box",
            transition: "border-color 200ms ease",
          }}
          onfocus={(e: FocusEvent) => { (e.target as HTMLInputElement).style.borderColor = "var(--neon-blue)"; }}
          onblur={(e: FocusEvent) => { (e.target as HTMLInputElement).style.borderColor = "var(--ctp-surface1)"; }}
        />
      </div>

      {/* Connection status */}
      <SessionStatus
        connectionStatus={store.state.connectionStatus}
        sessionCount={store.sessionCount()}
      />

      {/* Session list */}
      <div
        style={{
          flex: "1",
          overflow: "auto",
          padding: "4px 8px",
        }}
      >
        <Show
          when={sortedSessions().length > 0}
          fallback={
            <div
              style={{
                padding: "24px 16px",
                "text-align": "center",
                color: "var(--ctp-overlay0)",
                "font-size": "12px",
              }}
            >
              No sessions found
            </div>
          }
        >
          <For each={sortedSessions()}>
            {(session) => (
              <SessionCard
                session={session}
                isActive={store.state.activeSessionId === session.id}
                orbState={
                  store.state.activeSessionId === session.id
                    ? store.state.orbState
                    : orbStateForSession(session)
                }
                onClick={() => store.setActiveSession(session.id)}
              />
            )}
          </For>
        </Show>
      </div>

      {/* New Session — CLI Picker */}
      <div style={{ padding: "8px", position: "relative" }}>
        {/* CLI type picker — renders ABOVE the button */}
        <Show when={showCliPicker()}>
          <div
            data-testid="cli-picker"
            style={{
              position: "absolute",
              bottom: "100%",
              left: "8px",
              right: "8px",
              display: "flex",
              "flex-direction": "column",
              gap: "2px",
              padding: "4px",
              background: "var(--ctp-mantle)",
              border: "1px solid rgba(0,255,157,0.2)",
              "border-bottom": "none",
              "border-radius": "6px 6px 0 0",
              "box-shadow": "0 -4px 16px rgba(0,0,0,0.4)",
              "z-index": "20",
            }}
          >
            <For each={CLI_OPTIONS}>
              {(opt) => (
                <button
                  data-testid={`cli-option-${opt.type}`}
                  onClick={() => spawnSession(opt.type)}
                  disabled={spawning()}
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "10px",
                    width: "100%",
                    padding: "8px 10px",
                    background: "transparent",
                    border: "1px solid transparent",
                    "border-radius": "4px",
                    color: "var(--ctp-text)",
                    cursor: spawning() ? "wait" : "pointer",
                    transition: "all 150ms ease",
                    opacity: spawning() ? "0.5" : "1",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `${opt.color}12`;
                    e.currentTarget.style.borderColor = `${opt.color}40`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "transparent";
                  }}
                >
                  <div style={{
                    width: "28px",
                    height: "28px",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    "border-radius": "6px",
                    background: `${opt.color}15`,
                    "flex-shrink": "0",
                  }}>
                    {opt.Logo()}
                  </div>
                  <div style={{ display: "flex", "flex-direction": "column", gap: "1px" }}>
                    <span style={{
                      "font-size": "12px",
                      "font-weight": "600",
                      "font-family": "var(--font-mono)",
                      color: opt.color,
                    }}>
                      {opt.label}
                    </span>
                    <span style={{
                      "font-size": "9px",
                      color: "var(--ctp-overlay0)",
                      "font-family": "var(--font-mono)",
                      "letter-spacing": "0.05em",
                    }}>
                      {opt.desc}
                    </span>
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Toggle button */}
        <button
          data-testid="new-session-btn"
          onClick={() => setShowCliPicker((v) => !v)}
          style={{
            width: "100%",
            padding: "8px",
            background: showCliPicker()
              ? "var(--ctp-surface0)"
              : "rgba(0,255,157,0.08)",
            border: showCliPicker()
              ? "1px solid var(--ctp-surface1)"
              : "1px solid rgba(0,255,157,0.2)",
            "border-radius": showCliPicker() ? "0 0 6px 6px" : "6px",
            color: showCliPicker()
              ? "var(--ctp-subtext0)"
              : "var(--neon-green, #00ff9d)",
            "font-size": "12px",
            "font-weight": "600",
            "font-family": "var(--font-mono)",
            cursor: "pointer",
            transition: "all 150ms ease",
          }}
        >
          {showCliPicker() ? "- Cancel" : "+ New Session"}
        </button>
      </div>
    </div>
  );
}
