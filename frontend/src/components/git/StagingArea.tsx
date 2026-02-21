import { createSignal, For, Show } from "solid-js";

interface FileEntry {
  path: string;
  status: string;
  staged: boolean;
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
  const [commitMsg, setCommitMsg] = createSignal("");

  // Demo data — replaced by WebTransport RPC in production
  const [files, setFiles] = createSignal<FileEntry[]>([
    { path: "server/src/git/blame.rs", status: "added", staged: true },
    { path: "server/src/git/status.rs", status: "added", staged: true },
    { path: "server/src/git/mod.rs", status: "modified", staged: true },
    { path: "frontend/src/components/git/BranchSelector.tsx", status: "added", staged: false },
    { path: "frontend/src/components/git/StagingArea.tsx", status: "added", staged: false },
    { path: "README.md", status: "modified", staged: false },
  ]);

  const stagedFiles = () => files().filter((f) => f.staged);
  const unstagedFiles = () => files().filter((f) => !f.staged);

  const toggleStage = (path: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, staged: !f.staged } : f)),
    );
  };

  const stageAll = () => {
    setFiles((prev) => prev.map((f) => ({ ...f, staged: true })));
  };

  const unstageAll = () => {
    setFiles((prev) => prev.map((f) => ({ ...f, staged: false })));
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
              onClick={unstageAll}
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
            <FileRow file={file} onToggle={() => toggleStage(file.path)} />
          )}
        </For>
      </div>

      {/* Unstaged section */}
      <div style={{ "flex-shrink": "0", "border-top": "1px solid var(--ctp-surface0)", "margin-top": "4px" }}>
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
              onClick={stageAll}
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
            <FileRow file={file} onToggle={() => toggleStage(file.path)} />
          )}
        </For>
      </div>

      {/* Commit box */}
      <div style={{ "margin-top": "auto", padding: "8px", "border-top": "1px solid var(--ctp-surface0)" }}>
        <textarea
          value={commitMsg()}
          onInput={(e) => setCommitMsg(e.currentTarget.value)}
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
            resize: "vertical",
            outline: "none",
            "box-sizing": "border-box",
          }}
        />
        <button
          disabled={stagedFiles().length === 0 || !commitMsg()}
          style={{
            "margin-top": "6px",
            width: "100%",
            padding: "6px",
            background: stagedFiles().length > 0 && commitMsg() ? "var(--ctp-blue)" : "var(--ctp-surface1)",
            border: "none",
            "border-radius": "4px",
            color: stagedFiles().length > 0 && commitMsg() ? "var(--ctp-base)" : "var(--ctp-overlay0)",
            "font-size": "12px",
            "font-weight": "600",
            cursor: stagedFiles().length > 0 && commitMsg() ? "pointer" : "default",
          }}
        >
          Commit ({stagedFiles().length} file{stagedFiles().length !== 1 ? "s" : ""})
        </button>
      </div>
    </div>
  );
}

function FileRow(props: { file: FileEntry; onToggle: () => void }) {
  const fileName = () => props.file.path.split("/").pop() ?? props.file.path;
  const dirPath = () => {
    const parts = props.file.path.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
  };

  return (
    <button
      onClick={props.onToggle}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "6px",
        width: "100%",
        padding: "3px 8px",
        background: "transparent",
        border: "none",
        color: "var(--ctp-text)",
        "font-size": "12px",
        cursor: "pointer",
        "text-align": "left",
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
      <span
        style={{
          width: "16px",
          height: "16px",
          "border-radius": "3px",
          border: `1px solid ${props.file.staged ? "var(--ctp-blue)" : "var(--ctp-surface2)"}`,
          background: props.file.staged ? "var(--ctp-blue)" : "transparent",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "flex-shrink": "0",
          "font-size": "10px",
          color: "var(--ctp-base)",
        }}
      >
        {props.file.staged ? "\u2713" : ""}
      </span>
    </button>
  );
}
