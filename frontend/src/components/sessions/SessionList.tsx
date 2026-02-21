import { createSignal, createMemo, For, Show } from "solid-js";
import { useSession } from "../../App";
import type { Session } from "../../stores/session";
import type { OrbState } from "../../types/messages";
import SessionCard from "./SessionCard";
import SessionStatus from "./SessionStatus";

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

export default function SessionList() {
  const store = useSession();
  const [filter, setFilter] = createSignal("");

  const sortedSessions = createMemo(() => {
    const query = filter().toLowerCase();
    return [...store.state.sessions]
      .filter(
        (s) =>
          !query ||
          s.path.toLowerCase().includes(query) ||
          (s.model ?? "").toLowerCase().includes(query),
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
            "font-size": "14px",
            "font-weight": "600",
            color: "var(--ctp-subtext1)",
            "text-transform": "uppercase",
            "letter-spacing": "0.05em",
            margin: "0 0 12px",
          }}
        >
          Sessions
        </h2>

        {/* Search filter */}
        <input
          type="text"
          placeholder="Filter sessions..."
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          style={{
            width: "100%",
            padding: "6px 10px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "6px",
            color: "var(--ctp-text)",
            "font-size": "12px",
            outline: "none",
            "box-sizing": "border-box",
          }}
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

      {/* New Session button */}
      <div style={{ padding: "8px" }}>
        <button
          style={{
            width: "100%",
            padding: "8px",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "8px",
            color: "var(--ctp-subtext0)",
            "font-size": "12px",
            cursor: "pointer",
            transition: "background 150ms ease",
          }}
        >
          + New Session
        </button>
      </div>
    </div>
  );
}
