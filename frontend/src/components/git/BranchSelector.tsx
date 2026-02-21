import { createSignal, For, Show } from "solid-js";

interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
}

export default function BranchSelector() {
  const [open, setOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");

  // Demo data — replaced by WebTransport RPC in production
  const [branches] = createSignal<Branch[]>([
    { name: "main", isCurrent: false, isRemote: false, upstream: "origin/main" },
    { name: "feat/wp14-git-integration", isCurrent: true, isRemote: false },
    { name: "feat/wp15-teams", isCurrent: false, isRemote: false },
    { name: "origin/main", isCurrent: false, isRemote: true },
    { name: "origin/feat/wp14-git-integration", isCurrent: false, isRemote: true },
  ]);

  const filtered = () => {
    const q = filter().toLowerCase();
    if (!q) return branches();
    return branches().filter((b) => b.name.toLowerCase().includes(q));
  };

  const currentBranch = () => branches().find((b) => b.isCurrent)?.name ?? "main";

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open())}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "4px 10px",
          background: "var(--ctp-surface0)",
          border: "1px solid var(--ctp-surface1)",
          "border-radius": "4px",
          color: "var(--ctp-text)",
          "font-size": "12px",
          cursor: "pointer",
          width: "100%",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path
            d="M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6-1a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-1 1H6v2h4V8z"
            fill="var(--ctp-green)"
          />
        </svg>
        <span style={{ flex: "1", "text-align": "left", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
          {currentBranch()}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="var(--ctp-overlay0)">
          <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" />
        </svg>
      </button>

      <Show when={open()}>
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: "0",
            right: "0",
            background: "var(--ctp-surface0)",
            border: "1px solid var(--ctp-surface1)",
            "border-radius": "6px",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
            "z-index": "100",
            "max-height": "240px",
            overflow: "hidden",
            display: "flex",
            "flex-direction": "column",
          }}
        >
          <div style={{ padding: "6px" }}>
            <input
              type="text"
              placeholder="Filter branches..."
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
              style={{
                width: "100%",
                padding: "4px 8px",
                background: "var(--ctp-base)",
                border: "1px solid var(--ctp-surface1)",
                "border-radius": "4px",
                color: "var(--ctp-text)",
                "font-size": "11px",
                outline: "none",
                "box-sizing": "border-box",
              }}
            />
          </div>
          <div style={{ "overflow-y": "auto", flex: "1" }}>
            <div style={{ padding: "2px 6px 4px", "font-size": "10px", color: "var(--ctp-overlay0)", "text-transform": "uppercase", "letter-spacing": "0.5px" }}>
              Local
            </div>
            <For each={filtered().filter((b) => !b.isRemote)}>
              {(branch) => (
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "6px",
                    width: "100%",
                    padding: "4px 10px",
                    background: branch.isCurrent ? "var(--ctp-surface1)" : "transparent",
                    border: "none",
                    color: "var(--ctp-text)",
                    "font-size": "12px",
                    cursor: "pointer",
                    "text-align": "left",
                  }}
                >
                  <span style={{ width: "12px", "text-align": "center", color: "var(--ctp-green)" }}>
                    {branch.isCurrent ? "\u2713" : ""}
                  </span>
                  <span style={{ flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                    {branch.name}
                  </span>
                  <Show when={branch.upstream}>
                    <span style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>
                      {branch.upstream}
                    </span>
                  </Show>
                </button>
              )}
            </For>

            <Show when={filtered().some((b) => b.isRemote)}>
              <div style={{ padding: "6px 6px 2px", "font-size": "10px", color: "var(--ctp-overlay0)", "text-transform": "uppercase", "letter-spacing": "0.5px", "border-top": "1px solid var(--ctp-surface1)", "margin-top": "4px" }}>
                Remote
              </div>
              <For each={filtered().filter((b) => b.isRemote)}>
                {(branch) => (
                  <button
                    onClick={() => setOpen(false)}
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "6px",
                      width: "100%",
                      padding: "4px 10px",
                      background: "transparent",
                      border: "none",
                      color: "var(--ctp-subtext0)",
                      "font-size": "12px",
                      cursor: "pointer",
                      "text-align": "left",
                    }}
                  >
                    <span style={{ width: "12px" }} />
                    <span style={{ flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                      {branch.name}
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
