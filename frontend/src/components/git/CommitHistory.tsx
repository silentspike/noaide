import { createSignal, createResource, For, Show } from "solid-js";
import { useSession } from "../../App";

interface Commit {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

export default function CommitHistory() {
  const store = useSession();
  const [selected, setSelected] = createSignal<string | null>(null);

  const apiUrl = () => store.state.httpApiUrl;
  const sessionId = () => store.state.activeSessionId;

  const fetchCommits = async (): Promise<Commit[]> => {
    const base = apiUrl();
    if (!base) return [];
    const sid = sessionId();
    const params = new URLSearchParams();
    if (sid) params.set("session_id", sid);
    params.set("limit", "50");
    const resp = await fetch(`${base}/api/git/log?${params}`);
    if (!resp.ok) return [];
    return resp.json();
  };

  const [commits] = createResource(() => apiUrl(), fetchCommits);

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "font-size": "12px",
        color: "var(--ctp-text)",
        "overflow-y": "auto",
      }}
    >
      <div
        style={{
          padding: "4px 8px",
          "font-size": "10px",
          "text-transform": "uppercase",
          "letter-spacing": "0.5px",
          color: "var(--ctp-overlay0)",
          "border-bottom": "1px solid var(--ctp-surface0)",
        }}
      >
        Commits ({(commits() ?? []).length})
      </div>

      <For each={commits() ?? []}>
        {(commit) => (
          <button
            onClick={() =>
              setSelected(
                selected() === commit.hash ? null : commit.hash,
              )
            }
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "2px",
              width: "100%",
              padding: "6px 8px",
              background:
                selected() === commit.hash
                  ? "var(--ctp-surface0)"
                  : "transparent",
              border: "none",
              "border-bottom": "1px solid var(--ctp-surface0)",
              color: "var(--ctp-text)",
              "font-size": "12px",
              cursor: "pointer",
              "text-align": "left",
            }}
          >
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "6px",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  "border-radius": "50%",
                  background: "var(--ctp-blue)",
                  "flex-shrink": "0",
                }}
              />
              <span
                style={{
                  flex: "1",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                  "font-weight": "500",
                }}
              >
                {commit.message.split("\n")[0]}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                "padding-left": "14px",
                "font-size": "11px",
                color: "var(--ctp-overlay0)",
              }}
            >
              <code
                style={{
                  "font-family": "var(--font-mono)",
                  color: "var(--ctp-peach)",
                  "font-size": "10px",
                }}
              >
                {commit.short_hash}
              </code>
              <span>{commit.author}</span>
              <span style={{ "margin-left": "auto" }}>
                {timeAgo(commit.timestamp)}
              </span>
            </div>

            <Show when={selected() === commit.hash}>
              <div
                style={{
                  "margin-top": "4px",
                  "padding-left": "14px",
                  "font-size": "11px",
                  color: "var(--ctp-subtext0)",
                }}
              >
                <div style={{ "margin-bottom": "2px" }}>
                  <span style={{ color: "var(--ctp-overlay0)" }}>Hash: </span>
                  <code
                    style={{
                      "font-family": "var(--font-mono)",
                      "font-size": "10px",
                    }}
                  >
                    {commit.hash}
                  </code>
                </div>
                <div>
                  <span style={{ color: "var(--ctp-overlay0)" }}>
                    Author:{" "}
                  </span>
                  {commit.author} &lt;{commit.email}&gt;
                </div>
                <div>
                  <span style={{ color: "var(--ctp-overlay0)" }}>Date: </span>
                  {new Date(commit.timestamp * 1000).toLocaleString()}
                </div>
              </div>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
