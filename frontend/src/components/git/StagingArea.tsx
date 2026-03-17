import { createSignal, createResource, For, Show } from "solid-js";
import { useSession } from "../../App";

interface FileEntry {
  path: string;
  status: string;
  staged: boolean;
  hunks?: number; // number of diff hunks (for hunk-level staging hint)
}

const statusColors: Record<string, string> = {
  added: "var(--ctp-green)",
  modified: "var(--ctp-yellow)",
  deleted: "var(--ctp-red)",
  renamed: "var(--ctp-blue)",
  untracked: "var(--ctp-overlay0)",
  conflict: "var(--ctp-red)",
};

const statusIcons: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  conflict: "!",
};

export default function StagingArea() {
  const store = useSession();
  const [commitMsg, setCommitMsg] = createSignal("");

  const apiUrl = () => store.state.httpApiUrl;
  const sessionId = () => store.state.activeSessionId;

  const fetchStatus = async (): Promise<FileEntry[]> => {
    const base = apiUrl();
    if (!base) return [];
    const sid = sessionId();
    const url = sid
      ? `${base}/api/git/status?session_id=${sid}`
      : `${base}/api/git/status`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    return resp.json();
  };

  const [files, { refetch }] = createResource(
    () => [apiUrl(), sessionId()] as const,
    fetchStatus,
  );

  const stagedFiles = () => (files() ?? []).filter((f) => f.staged);
  const unstagedFiles = () => (files() ?? []).filter((f) => !f.staged);

  const doStage = async (paths: string[]) => {
    const base = apiUrl();
    if (!base) return;
    const sid = sessionId();
    await fetch(`${base}/api/git/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sid ?? undefined, paths }),
    });
    refetch();
  };

  const doUnstage = async (paths: string[]) => {
    const base = apiUrl();
    if (!base) return;
    const sid = sessionId();
    await fetch(`${base}/api/git/unstage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sid ?? undefined, paths }),
    });
    refetch();
  };

  const doCommit = async () => {
    const base = apiUrl();
    const msg = commitMsg().trim();
    if (!base || !msg) return;
    const sid = sessionId();
    const resp = await fetch(`${base}/api/git/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sid ?? undefined, message: msg }),
    });
    if (resp.ok) {
      setCommitMsg("");
      refetch();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "font-size": "12px",
        color: "var(--ctp-text)",
      }}
    >
      {/* Staged section */}
      <div style={{ "flex-shrink": "0" }}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "4px 8px",
            "font-size": "10px",
            "text-transform": "uppercase",
            "letter-spacing": "0.5px",
            color: "var(--ctp-overlay0)",
          }}
        >
          <span>Staged ({stagedFiles().length})</span>
          <Show when={stagedFiles().length > 0}>
            <button
              onClick={() =>
                doUnstage(stagedFiles().map((f) => f.path))
              }
              style={{
                background: "none",
                border: "none",
                color: "var(--ctp-overlay0)",
                "font-size": "10px",
                cursor: "pointer",
                padding: "0 4px",
              }}
            >
              Unstage all
            </button>
          </Show>
        </div>
        <For each={stagedFiles()}>
          {(file) => (
            <FileRow
              file={file}
              actionLabel="−"
              onAction={() => doUnstage([file.path])}
            />
          )}
        </For>
      </div>

      {/* Unstaged section */}
      <div
        style={{
          "flex-shrink": "0",
          "border-top": "1px solid var(--ctp-surface0)",
          "margin-top": "4px",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "4px 8px",
            "font-size": "10px",
            "text-transform": "uppercase",
            "letter-spacing": "0.5px",
            color: "var(--ctp-overlay0)",
          }}
        >
          <span>Changes ({unstagedFiles().length})</span>
          <Show when={unstagedFiles().length > 0}>
            <button
              onClick={() =>
                doStage(unstagedFiles().map((f) => f.path))
              }
              style={{
                background: "none",
                border: "none",
                color: "var(--ctp-overlay0)",
                "font-size": "10px",
                cursor: "pointer",
                padding: "0 4px",
              }}
            >
              Stage all
            </button>
          </Show>
        </div>
        <For each={unstagedFiles()}>
          {(file) => (
            <FileRow
              file={file}
              actionLabel="+"
              onAction={() => doStage([file.path])}
            />
          )}
        </For>
      </div>

      {/* Commit box */}
      <div
        style={{
          "margin-top": "auto",
          padding: "8px",
          "border-top": "1px solid var(--ctp-surface0)",
        }}
      >
        <textarea
          value={commitMsg()}
          onInput={(e) => {
            setCommitMsg(e.currentTarget.value);
            e.currentTarget.style.height = "auto";
            e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
          }}
          placeholder="Commit message..."
          rows={3}
          style={{
            width: "100%",
            padding: "6px 8px",
            background: "var(--ctp-base)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "4px",
            color: "var(--ctp-text)",
            "font-size": "12px",
            "font-family": "inherit",
            resize: "none",
            overflow: "hidden",
            outline: "none",
            "box-sizing": "border-box",
          }}
        />
        <div
          style={{
            "font-size": "10px",
            color: "var(--ctp-overlay0)",
            "text-align": "right",
            padding: "2px 0",
          }}
        >
          {commitMsg().length}
        </div>
        <button
          disabled={stagedFiles().length === 0 || !commitMsg()}
          onClick={doCommit}
          style={{
            "margin-top": "6px",
            width: "100%",
            padding: "6px",
            background:
              stagedFiles().length > 0 && commitMsg()
                ? "var(--ctp-blue)"
                : "var(--ctp-surface1)",
            border: "none",
            "border-radius": "4px",
            color:
              stagedFiles().length > 0 && commitMsg()
                ? "var(--ctp-base)"
                : "var(--ctp-overlay0)",
            "font-size": "12px",
            "font-weight": "600",
            cursor:
              stagedFiles().length > 0 && commitMsg() ? "pointer" : "default",
          }}
        >
          Commit ({stagedFiles().length} file
          {stagedFiles().length !== 1 ? "s" : ""})
        </button>
      </div>
    </div>
  );
}

function FileRow(props: {
  file: FileEntry;
  actionLabel: string;
  onAction: () => void;
}) {
  const fileName = () => props.file.path.split("/").pop() ?? props.file.path;
  const dirPath = () => {
    const parts = props.file.path.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
  };

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "6px",
        width: "100%",
        padding: "3px 8px",
        "font-size": "12px",
        color: "var(--ctp-text)",
      }}
    >
      <span
        style={{
          width: "14px",
          height: "14px",
          "text-align": "center",
          "font-size": "10px",
          "font-weight": "700",
          color: statusColors[props.file.status] ?? "var(--ctp-text)",
        }}
      >
        {statusIcons[props.file.status] ?? "?"}
      </span>
      <span
        style={{
          flex: "1",
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
        }}
      >
        <span style={{ color: "var(--ctp-overlay0)" }}>{dirPath()}</span>
        <span>{fileName()}</span>
      </span>
      <button
        onClick={() => props.onAction()}
        style={{
          width: "18px",
          height: "18px",
          "border-radius": "3px",
          border: "1px solid var(--ctp-surface2)",
          background: "transparent",
          color: "var(--ctp-overlay0)",
          "font-size": "12px",
          "line-height": "1",
          cursor: "pointer",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "flex-shrink": "0",
          padding: "0",
        }}
      >
        {props.actionLabel}
      </button>
    </div>
  );
}
