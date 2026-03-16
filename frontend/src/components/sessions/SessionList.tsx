import { createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js";
import { useSession } from "../../App";
import type { Session } from "../../stores/session";
import type { OrbState } from "../../types/messages";
import SessionCard from "./SessionCard";
import SessionStatus from "./SessionStatus";
import ThemeSlider from "./ThemeSlider";
import FontSlider from "./FontSlider";
import VirtualScroller from "../chat/VirtualScroller";

// ── Sort/Group types ──
type SortBy = "activity" | "name" | "messages" | "started" | "cost";
type GroupBy = "none" | "cliType" | "status" | "project";

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "activity", label: "Activity" },
  { value: "name", label: "Name" },
  { value: "messages", label: "Messages" },
  { value: "started", label: "Started" },
  { value: "cost", label: "Cost" },
];

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "cliType", label: "CLI Type" },
  { value: "status", label: "Status" },
  { value: "project", label: "Project" },
];

// ── Context Menu ──
interface ContextMenuState {
  sessionId: string;
  sessionName: string;
  x: number;
  y: number;
}

function SessionContextMenu(props: {
  state: ContextMenuState;
  onClose: () => void;
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  isPinned: boolean;
}) {
  let menuRef: HTMLDivElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) props.onClose();
  };
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };
  const handleScroll = () => props.onClose();

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("scroll", handleScroll, true);
  });
  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
    document.removeEventListener("keydown", handleEscape);
    document.removeEventListener("scroll", handleScroll, true);
  });

  const itemStyle = {
    display: "block",
    width: "100%",
    padding: "6px 14px",
    background: "none",
    border: "none",
    color: "var(--ctp-text)",
    "font-size": "12px",
    "font-family": "var(--font-mono)",
    cursor: "pointer",
    "text-align": "left" as const,
  };

  return (
    <div
      ref={menuRef}
      data-testid="context-menu"
      style={{
        position: "fixed",
        left: `${props.state.x}px`,
        top: `${props.state.y}px`,
        "z-index": "9999",
        background: "var(--ctp-surface0)",
        "backdrop-filter": "blur(12px)",
        "-webkit-backdrop-filter": "blur(12px)",
        border: "1px solid var(--ctp-surface1)",
        "border-radius": "8px",
        "box-shadow": "0 4px 16px rgba(0,0,0,0.4)",
        "min-width": "160px",
        padding: "4px 0",
        "overflow": "hidden",
      }}
    >
      <button
        data-testid="context-menu-pin"
        style={itemStyle}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--ctp-surface1)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
        onClick={() => { props.onPin(props.state.sessionId); props.onClose(); }}
      >
        {props.isPinned ? "\u2605 Unpin" : "\u2606 Pin"}
      </button>
      <button
        data-testid="context-menu-copy-id"
        style={itemStyle}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--ctp-surface1)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
        onClick={() => { navigator.clipboard.writeText(props.state.sessionId); props.onClose(); }}
      >
        Copy Session ID
      </button>
      <button
        data-testid="context-menu-archive"
        style={itemStyle}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--ctp-surface1)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
        onClick={() => { props.onArchive(props.state.sessionId); props.onClose(); }}
      >
        Archive
      </button>
      <div style={{ height: "1px", background: "var(--ctp-surface2)", margin: "4px 0" }} />
      <button
        data-testid="context-menu-delete"
        style={{ ...itemStyle, color: "var(--ctp-red)" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(243,139,168,0.1)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
        onClick={() => { props.onDelete(props.state.sessionId, props.state.sessionName); props.onClose(); }}
      >
        Delete
      </button>
    </div>
  );
}

function DeleteConfirmDialog(props: {
  sessionName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="delete-confirm-dialog"
      style={{
        position: "fixed",
        inset: "0",
        "z-index": "10000",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        background: "rgba(0,0,0,0.5)",
        "backdrop-filter": "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}
    >
      <div style={{
        background: "var(--ctp-base)",
        border: "1px solid var(--ctp-surface1)",
        "border-radius": "12px",
        padding: "20px",
        "min-width": "300px",
        "max-width": "400px",
        "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <h3 style={{ margin: "0 0 12px", color: "var(--ctp-red)", "font-size": "14px" }}>Delete Session</h3>
        <p style={{ margin: "0 0 16px", color: "var(--ctp-subtext0)", "font-size": "12px", "line-height": "1.5" }}>
          Delete session <strong style={{ color: "var(--ctp-text)" }}>{props.sessionName}</strong>?
          This deletes all JSONL data permanently.
        </p>
        <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end" }}>
          <button
            data-testid="delete-confirm-no"
            onClick={props.onCancel}
            style={{
              padding: "6px 16px", background: "var(--ctp-surface0)", color: "var(--ctp-text)",
              border: "1px solid var(--ctp-surface1)", "border-radius": "6px", cursor: "pointer",
              "font-size": "12px",
            }}
          >
            Cancel
          </button>
          <button
            data-testid="delete-confirm-yes"
            onClick={props.onConfirm}
            style={{
              padding: "6px 16px", background: "var(--ctp-red)", color: "var(--ctp-base)",
              border: "none", "border-radius": "6px", cursor: "pointer", "font-weight": "600",
              "font-size": "12px",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
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

/** Format bytes to human readable. */
function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)}G` : `${Math.round(mb)}M`;
}

export default function SessionList() {
  const store = useSession();
  const [filter, setFilter] = createSignal("");
  const [showCliPicker, setShowCliPicker] = createSignal(false);
  const [spawning, setSpawning] = createSignal(false);
  const [memUsage, setMemUsage] = createSignal("");
  const [workingDir, setWorkingDir] = createSignal("/work");
  const [browseDirs, setBrowseDirs] = createSignal<{ name: string; path: string }[]>([]);
  const [showBrowser, setShowBrowser] = createSignal(false);
  const [browseLoading, setBrowseLoading] = createSignal(false);

  // ── Sort / Group / Archive ──
  const [sortBy, setSortBy] = createSignal<SortBy>(
    (localStorage.getItem("noaide-sort-pref") as SortBy) || "activity"
  );
  const [groupBy, setGroupBy] = createSignal<GroupBy>(
    (localStorage.getItem("noaide-group-pref") as GroupBy) || "none"
  );
  const [showArchived, setShowArchived] = createSignal(
    localStorage.getItem("noaide-show-archived") === "true"
  );

  // ── Tags ──
  const [sessionTags, setSessionTags] = createSignal<Map<string, string[]>>(
    (() => {
      try {
        const raw = localStorage.getItem("noaide-session-tags");
        if (raw) return new Map(JSON.parse(raw));
      } catch { /* ignore */ }
      return new Map<string, string[]>();
    })()
  );
  function addTag(sessionId: string, tag: string) {
    const next = new Map(sessionTags());
    const tags = next.get(sessionId) || [];
    if (!tags.includes(tag)) {
      next.set(sessionId, [...tags, tag]);
      setSessionTags(next);
      localStorage.setItem("noaide-session-tags", JSON.stringify([...next]));
    }
  }
  function removeTag(sessionId: string, tag: string) {
    const next = new Map(sessionTags());
    const tags = (next.get(sessionId) || []).filter((t: string) => t !== tag);
    if (tags.length === 0) next.delete(sessionId); else next.set(sessionId, tags);
    setSessionTags(next);
    localStorage.setItem("noaide-session-tags", JSON.stringify([...next]));
  }

  // Persist preferences
  const updateSort = (v: SortBy) => { setSortBy(v); localStorage.setItem("noaide-sort-pref", v); };
  const updateGroup = (v: GroupBy) => { setGroupBy(v); localStorage.setItem("noaide-group-pref", v); };
  const toggleArchived = () => {
    const next = !showArchived();
    setShowArchived(next);
    localStorage.setItem("noaide-show-archived", String(next));
  };

  // ── Context Menu ──
  const [ctxMenu, setCtxMenu] = createSignal<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<{ id: string; name: string } | null>(null);

  function handleContextMenu(e: MouseEvent, session: Session) {
    e.preventDefault();
    setCtxMenu({
      sessionId: session.id,
      sessionName: session.path.split("/").pop() || session.path,
      x: e.clientX,
      y: e.clientY,
    });
  }

  async function handleDelete(id: string) {
    try {
      const base = store.state.httpApiUrl || "";
      await fetch(`${base}/api/sessions/${id}`, { method: "DELETE" });
      store.removeSession(id);
      if (store.state.activeSessionId === id) {
        store.setActiveSession(null as unknown as string);
      }
    } catch (err) {
      console.warn("[session] delete failed:", err);
    }
    setDeleteTarget(null);
  }

  // Poll browser memory usage (Chrome performance.memory API)
  onMount(() => {
    function updateMem() {
      const perf = performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      };
      if (perf.memory) {
        const used = formatMB(perf.memory.usedJSHeapSize);
        const limit = formatMB(perf.memory.jsHeapSizeLimit);
        setMemUsage(`${used} / ${limit}`);
      } else {
        setMemUsage("");
      }
    }
    updateMem();
    const interval = setInterval(updateMem, 3000);
    onCleanup(() => clearInterval(interval));
  });

  async function browseDirectory(path: string) {
    const base = store.state.httpApiUrl;
    if (!base) return;
    setBrowseLoading(true);
    try {
      const res = await fetch(`${base}/api/browse?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data: { name: string; path: string }[] = await res.json();
        setBrowseDirs(data);
        setWorkingDir(path);
        setShowBrowser(true);
      }
    } catch {
      /* ignore */
    } finally {
      setBrowseLoading(false);
    }
  }

  async function spawnSession(cliType: CliType) {
    const base = store.state.httpApiUrl;
    if (!base || spawning()) return;
    setSpawning(true);
    try {
      const res = await fetch(`${base}/api/sessions/managed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_dir: workingDir(), cli_type: cliType }),
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

  // Helper: get group key for a session
  function getGroupKey(s: Session, group: GroupBy): string {
    switch (group) {
      case "cliType": return (s.cliType ?? "claude").toUpperCase();
      case "status": return s.status;
      case "project": return s.path.split("/").slice(0, -1).join("/") || s.path;
      default: return "";
    }
  }

  const sortedSessions = createMemo(() => {
    store.sessionsVersion();
    const pinned = store.pinnedIds();
    const query = filter().toLowerCase();
    const sort = sortBy();
    const archived = showArchived();
    const group = groupBy();

    return [...store.state.sessions]
      .filter((s) => {
        // Archive filter
        if (!archived && s.status === "archived") return false;
        // Text filter (supports #tag syntax)
        if (!query) return true;
        if (query.startsWith("#")) {
          const tag = query.substring(1);
          const tags = sessionTags().get(s.id);
          return tags ? tags.some((t: string) => t.toLowerCase().includes(tag)) : false;
        }
        return (
          s.path.toLowerCase().includes(query) ||
          (s.model ?? "").toLowerCase().includes(query) ||
          s.id.toLowerCase().includes(query) ||
          (s.cliType ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        // Primary: pinned sessions first
        const aPinned = pinned.has(a.id) ? 1 : 0;
        const bPinned = pinned.has(b.id) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        // Grouping: sort by group key first
        if (group !== "none") {
          const aGroup = getGroupKey(a, group);
          const bGroup = getGroupKey(b, group);
          if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);
        }
        // Secondary: chosen sort
        switch (sort) {
          case "name": return a.path.localeCompare(b.path);
          case "messages": return b.messageCount - a.messageCount;
          case "started": return b.startedAt - a.startedAt;
          case "cost": return (b.cost ?? 0) - (a.cost ?? 0);
          default: return b.lastActivityAt - a.lastActivityAt;
        }
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
        <div
          style={{
            display: "flex",
            "align-items": "baseline",
            "justify-content": "space-between",
            margin: "0 0 12px",
          }}
        >
          <h2
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "10px",
              "font-weight": "700",
              color: "var(--neon-green, #00ff9d)",
              "text-transform": "uppercase",
              "letter-spacing": "0.15em",
              margin: "0",
            }}
          >
            Sessions
          </h2>
          <Show when={memUsage()}>
            <span
              style={{
                "font-family": "var(--font-mono)",
                "font-size": "9px",
                color: "var(--ctp-overlay1)",
                "letter-spacing": "0.02em",
              }}
              title="JS Heap Usage"
            >
              {memUsage()}
            </span>
          </Show>
        </div>

        {/* Theme Slider */}
        <ThemeSlider />

        {/* Font Slider */}
        <FontSlider />

        {/* Sort / Group / Archive Controls */}
        <div style={{ display: "flex", gap: "4px", "margin-bottom": "6px", "align-items": "center" }}>
          <select
            data-testid="session-sort-dropdown"
            value={sortBy()}
            onChange={(e) => updateSort(e.currentTarget.value as SortBy)}
            style={{
              flex: "1", padding: "4px 6px", background: "var(--ctp-surface0)",
              color: "var(--ctp-text)", border: "1px solid var(--ctp-surface1)",
              "border-radius": "4px", "font-size": "10px", "font-family": "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            <For each={SORT_OPTIONS}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
          <select
            data-testid="session-group-dropdown"
            value={groupBy()}
            onChange={(e) => updateGroup(e.currentTarget.value as GroupBy)}
            style={{
              flex: "1", padding: "4px 6px", background: "var(--ctp-surface0)",
              color: "var(--ctp-text)", border: "1px solid var(--ctp-surface1)",
              "border-radius": "4px", "font-size": "10px", "font-family": "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            <For each={GROUP_OPTIONS}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
          <button
            data-testid="archive-toggle"
            onClick={toggleArchived}
            title={showArchived() ? "Hide archived" : "Show archived"}
            style={{
              padding: "4px 8px", background: showArchived() ? "var(--ctp-surface1)" : "var(--ctp-surface0)",
              color: showArchived() ? "var(--ctp-text)" : "var(--ctp-overlay0)",
              border: "1px solid var(--ctp-surface1)", "border-radius": "4px",
              "font-size": "10px", cursor: "pointer", "white-space": "nowrap",
            }}
          >
            {showArchived() ? "All" : "Active"}
          </button>
        </div>

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

      {/* Session list (virtualized — only ~15 DOM nodes for 700+ sessions) */}
      <div
        style={{
          flex: "1",
          overflow: "hidden",
          padding: "0 8px",
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
          <VirtualScroller
            items={sortedSessions()}
            estimateHeight={56}
            overscan={5}
            getKey={(s: Session) => s.id}
            renderItem={(session: Session, index: number) => {
              // Group header: show when group changes between consecutive items
              const group = groupBy();
              const items = sortedSessions();
              const showGroupHeader = group !== "none" && (
                index === 0 || getGroupKey(items[index], group) !== getGroupKey(items[index - 1], group)
              );
              const groupLabel = group !== "none" ? getGroupKey(session, group) : "";
              const tags = sessionTags().get(session.id) || [];

              return (
                <div onContextMenu={(e) => handleContextMenu(e, session)}>
                  {showGroupHeader && (
                    <div
                      data-testid={`group-header-${groupLabel}`}
                      style={{
                        padding: "4px 8px",
                        "font-size": "9px",
                        "font-weight": "700",
                        "text-transform": "uppercase",
                        "letter-spacing": "0.1em",
                        color: "var(--ctp-overlay1)",
                        "border-top": index > 0 ? "1px solid var(--ctp-surface0)" : "none",
                        "margin-top": index > 0 ? "4px" : "0",
                      }}
                    >
                      {groupLabel}
                    </div>
                  )}
                  <SessionCard
                    session={session}
                    isActive={store.state.activeSessionId === session.id}
                    isPinned={store.isPinned(session.id)}
                    orbState={
                      store.state.activeSessionId === session.id
                        ? store.state.orbState
                        : orbStateForSession(session)
                    }
                    onClick={() => {
                      store.setActiveSession(session.id);
                      window.dispatchEvent(new CustomEvent("noaide:navigate-tab", { detail: "chat" }));
                    }}
                    onTogglePin={(id) => store.togglePin(id)}
                  />
                  {tags.length > 0 && (
                    <div data-testid={`session-tag-${session.id}`} style={{ display: "flex", gap: "3px", padding: "0 8px 4px", "flex-wrap": "wrap" }}>
                      <For each={tags}>
                        {(tag: string) => (
                          <span
                            style={{
                              "font-size": "9px",
                              padding: "1px 6px",
                              "border-radius": "3px",
                              background: "var(--ctp-surface1)",
                              color: "var(--ctp-subtext0)",
                              cursor: "pointer",
                            }}
                            onClick={(e) => { e.stopPropagation(); removeTag(session.id, tag); }}
                            title={`Remove tag: ${tag}`}
                          >
                            {tag} ×
                          </span>
                        )}
                      </For>
                    </div>
                  )}
                </div>
              );
            }}
          />
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
            {/* Directory picker */}
            <div style={{ padding: "4px 6px 6px", "border-bottom": "1px solid var(--ctp-surface0)", "margin-bottom": "2px" }}>
              <div style={{
                "font-size": "9px",
                "font-family": "var(--font-mono)",
                color: "var(--ctp-overlay0)",
                "text-transform": "uppercase",
                "letter-spacing": "0.08em",
                "margin-bottom": "4px",
              }}>
                Working Directory
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <input
                  type="text"
                  value={workingDir()}
                  onInput={(e) => setWorkingDir(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") browseDirectory(workingDir()); }}
                  style={{
                    flex: "1",
                    padding: "5px 8px",
                    background: "var(--ctp-base)",
                    border: "1px solid var(--ctp-surface1)",
                    "border-radius": "4px",
                    color: "var(--ctp-text)",
                    "font-size": "11px",
                    "font-family": "var(--font-mono)",
                    outline: "none",
                    "min-width": "0",
                  }}
                />
                <button
                  onClick={() => browseDirectory(workingDir())}
                  disabled={browseLoading()}
                  style={{
                    padding: "4px 8px",
                    background: "var(--ctp-surface0)",
                    border: "1px solid var(--ctp-surface1)",
                    "border-radius": "4px",
                    color: "var(--ctp-subtext0)",
                    "font-size": "10px",
                    "font-family": "var(--font-mono)",
                    cursor: "pointer",
                    "white-space": "nowrap",
                    "flex-shrink": "0",
                  }}
                >
                  {browseLoading() ? "..." : "Browse"}
                </button>
              </div>
              <Show when={showBrowser()}>
                <div style={{
                  "max-height": "160px",
                  overflow: "auto",
                  "margin-top": "4px",
                  background: "var(--ctp-base)",
                  border: "1px solid var(--ctp-surface1)",
                  "border-radius": "4px",
                }}>
                  <For each={browseDirs()}>
                    {(dir) => (
                      <button
                        onClick={() => {
                          if (dir.name === "..") {
                            browseDirectory(dir.path);
                          } else {
                            setWorkingDir(dir.path);
                            setShowBrowser(false);
                          }
                        }}
                        onDblClick={() => browseDirectory(dir.path)}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "4px 8px",
                          background: "transparent",
                          border: "none",
                          "border-bottom": "1px solid var(--ctp-surface0)",
                          color: dir.name === ".." ? "var(--ctp-overlay1)" : "var(--ctp-text)",
                          "font-size": "11px",
                          "font-family": "var(--font-mono)",
                          "text-align": "left",
                          cursor: "pointer",
                          transition: "background 100ms",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ctp-surface0)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        {dir.name === ".." ? "\u2190 .." : "\u{1F4C1} " + dir.name}
                      </button>
                    )}
                  </For>
                  <Show when={browseDirs().length === 0}>
                    <div style={{ padding: "8px", "text-align": "center", color: "var(--ctp-overlay0)", "font-size": "10px" }}>
                      No subdirectories
                    </div>
                  </Show>
                </div>
              </Show>
            </div>

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

      {/* Context Menu */}
      <Show when={ctxMenu()}>
        {(menu) => (
          <SessionContextMenu
            state={menu()}
            onClose={() => setCtxMenu(null)}
            onPin={(id) => store.togglePin(id)}
            onArchive={() => { /* TODO: archive endpoint */ }}
            onDelete={(id, name) => setDeleteTarget({ id, name })}
            isPinned={store.isPinned(menu().sessionId)}
          />
        )}
      </Show>

      {/* Delete Confirmation */}
      <Show when={deleteTarget()}>
        {(target) => (
          <DeleteConfirmDialog
            sessionName={target().name}
            onConfirm={() => handleDelete(target().id)}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </Show>
    </div>
  );
}
