import { createStore, reconcile, produce } from "solid-js/store";
import { createSignal, batch } from "solid-js";
import type { SessionStore } from "./session";

// ── Types ──────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  /** Path relative to project root. */
  path: string;
  isDir: boolean;
  modified: number;
  /** Creation (birth) time as epoch seconds. 0 if unavailable. */
  created: number;
  size: number;
  /** For directories: total size of all files inside (recursive). */
  totalSize?: number;
  /** For directories: number of files inside (recursive). */
  fileCount?: number;
  /** Lazy-loaded children for directories. null = not loaded yet. */
  children?: FileEntry[] | null;
  /** True when this file was recently modified (visual indicator). */
  recentlyModified?: boolean;
  /** True when this file was just created (slide-in animation). */
  recentlyCreated?: boolean;
}

export interface FileChangePayload {
  path: string;
  kind: "created" | "modified" | "deleted";
  pid: number | null;
  session_id: string;
  project_root: string;
  timestamp: number;
  content: string | null;
  size: number | null;
}

interface FileStoreState {
  tree: FileEntry[];
  treeLoading: boolean;
  treeError: string | null;
  fileContent: string | null;
  fileContentLoading: boolean;
  claudeEditingFile: string | null;
  claudeEditingPid: number | null;
}

// ── Store ──────────────────────────────────────────────────────────────────

export interface FileStore {
  state: FileStoreState;
  selectedFile: () => string | null;
  selectFile: (path: string) => void;
  fetchTree: (sessionId: string) => Promise<void>;
  fetchSubtree: (sessionId: string, dirPath: string) => Promise<void>;
  fetchFileContent: (sessionId: string, path: string) => Promise<void>;
  handleFileChangeEvent: (payload: FileChangePayload) => void;
  saveFile: (sessionId: string, path: string, content: string) => Promise<boolean>;
}

export function createFileStore(sessionStore: SessionStore): FileStore {
  const [state, setState] = createStore<FileStoreState>({
    tree: [],
    treeLoading: false,
    treeError: null,
    fileContent: null,
    fileContentLoading: false,
    claudeEditingFile: null,
    claudeEditingPid: null,
  });

  const [selectedFile, setSelectedFile] = createSignal<string | null>(null);

  // Event batching for 120Hz: accumulate events per frame, apply in batch
  let pendingEvents: FileChangePayload[] = [];
  let rafId: number | null = null;

  // Claude edit timeout: 2s idle = editing finished
  let claudeEditTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // ── API helpers ──────────────────────────────────────────────────────

  const apiBase = () => {
    const url = sessionStore.state.httpApiUrl;
    return url ?? "";
  };

  async function fetchTree(sessionId: string) {
    setState("treeLoading", true);
    setState("treeError", null);
    try {
      const res = await fetch(`${apiBase()}/api/sessions/${sessionId}/files`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
      }
      const entries: FileEntry[] = await res.json();
      // Transform flat listing into tree structure:
      // API returns flat entries for the root level, dirs have children=null (lazy)
      const treeEntries = entries.map((e) => ({
        ...e,
        children: e.isDir ? null : undefined,
      }));
      setState("tree", reconcile(treeEntries, { key: "path" }));
    } catch (e: unknown) {
      setState("treeError", e instanceof Error ? e.message : String(e));
    } finally {
      setState("treeLoading", false);
    }
  }

  async function fetchSubtree(sessionId: string, dirPath: string) {
    try {
      const res = await fetch(
        `${apiBase()}/api/sessions/${sessionId}/files?path=${encodeURIComponent(dirPath)}`,
      );
      if (!res.ok) return;
      const entries: FileEntry[] = await res.json();
      const children = entries.map((e) => ({
        ...e,
        children: e.isDir ? null : undefined,
      }));

      // Find and update the directory node in the tree
      setState(
        "tree",
        produce((tree: FileEntry[]) => {
          insertChildren(tree, dirPath, children);
        }),
      );
    } catch {
      // Silently fail — directory may have been removed
    }
  }

  async function fetchFileContent(sessionId: string, path: string) {
    setState("fileContentLoading", true);
    try {
      const res = await fetch(
        `${apiBase()}/api/sessions/${sessionId}/file?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) {
        setState("fileContent", null);
        return;
      }
      const text = await res.text();
      setState("fileContent", text);
    } catch {
      setState("fileContent", null);
    } finally {
      setState("fileContentLoading", false);
    }
  }

  function selectFile(path: string) {
    setSelectedFile(path);
    const activeId = sessionStore.state.activeSessionId;
    if (activeId) {
      fetchFileContent(activeId, path);
    }
  }

  async function saveFile(sessionId: string, path: string, content: string): Promise<boolean> {
    try {
      const res = await fetch(`${apiBase()}/api/sessions/${sessionId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      if (!res.ok) return false;
      // Update local content to match saved state
      setState("fileContent", content);
      return true;
    } catch {
      return false;
    }
  }

  // ── FILE_CHANGES event handler (WebTransport Hot Path) ───────────────

  function handleFileChangeEvent(payload: FileChangePayload) {
    // Filter: only process events from the same project root as the active session.
    // Without this, events from /work/daw could corrupt the /work/noaide tree
    // if they share a relative path like "src/main.rs".
    const activeSession = sessionStore.activeSession();
    if (activeSession && payload.project_root && activeSession.path !== payload.project_root) {
      return;
    }

    pendingEvents.push(payload);

    // Batch: process all events that arrive in the same animation frame
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        const events = pendingEvents;
        pendingEvents = [];
        rafId = null;

        batch(() => {
          for (const evt of events) {
            applyTreeUpdate(evt);
          }
        });
      });
    }

    // Content push: update editor if this file is currently open
    const sel = selectedFile();
    if (payload.content && sel === payload.path) {
      setState("fileContent", payload.content);
    } else if (payload.kind === "modified" && sel === payload.path && !payload.content) {
      // Large file (>100KB): content not in event, REST fallback
      const activeId = sessionStore.state.activeSessionId;
      if (activeId) fetchFileContent(activeId, payload.path);
    }

    // Claude editing detection (eBPF PID, ADR-5)
    if (payload.pid && sel === payload.path) {
      setState("claudeEditingFile", payload.path);
      setState("claudeEditingPid", payload.pid);
      resetClaudeEditTimeout();
    }
  }

  function resetClaudeEditTimeout() {
    if (claudeEditTimeoutId) clearTimeout(claudeEditTimeoutId);
    claudeEditTimeoutId = setTimeout(() => {
      setState("claudeEditingFile", null);
      setState("claudeEditingPid", null);
    }, 2000);
  }

  // ── Tree mutation helpers ────────────────────────────────────────────

  function applyTreeUpdate(evt: FileChangePayload) {
    if (evt.kind === "created") {
      // For inserts: replace the array directly (SolidJS <For> needs new array ref)
      const current = [...state.tree];
      const parts = evt.path.split("/");
      const name = parts[parts.length - 1];

      if (parts.length === 1 && !current.some((e) => e.path === evt.path)) {
        // Top-level file: append + sort + replace
        current.push({
          name,
          path: evt.path,
          isDir: false,
          modified: evt.timestamp,
          created: evt.timestamp,
          size: evt.size ?? 0,
          recentlyModified: true,
          recentlyCreated: true,
        });
        current.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
        setState("tree", current);
      } else {
        // Nested: use produce for child arrays
        setState(
          "tree",
          produce((tree: FileEntry[]) => {
            insertTreeNode(tree, evt.path, evt.size ?? 0, evt.timestamp);
          }),
        );
      }
    } else if (evt.kind === "modified") {
      // Find the index and update via path-based setState (fine-grained)
      const idx = state.tree.findIndex((e) => e.path === evt.path);
      if (idx !== -1) {
        setState("tree", idx, "modified", evt.timestamp);
        setState("tree", idx, "recentlyModified", true);
      } else {
        // Nested: use produce
        setState(
          "tree",
          produce((tree: FileEntry[]) => {
            updateTreeNode(tree, evt.path, evt.timestamp);
          }),
        );
      }
    } else if (evt.kind === "deleted") {
      // For deletes: filter to new array
      const idx = state.tree.findIndex((e) => e.path === evt.path);
      if (idx !== -1) {
        setState("tree", (prev) => prev.filter((e) => e.path !== evt.path));
      } else {
        setState(
          "tree",
          produce((tree: FileEntry[]) => {
            removeTreeNode(tree, evt.path);
          }),
        );
      }
    }

    // Auto-clear animation flags after 3s
    if (evt.kind === "created" || evt.kind === "modified") {
      setTimeout(() => {
        const idx = state.tree.findIndex((e) => e.path === evt.path);
        if (idx !== -1) {
          setState("tree", idx, "recentlyModified", false);
          setState("tree", idx, "recentlyCreated", false);
        }
      }, 3000);
    }
  }

  return {
    state,
    selectedFile,
    selectFile,
    fetchTree,
    fetchSubtree,
    fetchFileContent,
    handleFileChangeEvent,
    saveFile,
  };
}

// ── Pure tree helpers ──────────────────────────────────────────────────────

function insertChildren(tree: FileEntry[], dirPath: string, children: FileEntry[]) {
  for (const node of tree) {
    if (node.path === dirPath && node.isDir) {
      node.children = children;
      return;
    }
    if (node.children) {
      insertChildren(node.children, dirPath, children);
    }
  }
}

function insertTreeNode(tree: FileEntry[], path: string, size: number, timestamp: number) {
  const parts = path.split("/");
  const name = parts[parts.length - 1];

  // Check if already exists
  if (tree.some((e) => e.path === path)) return;

  // Simple case: top-level entry
  if (parts.length === 1) {
    tree.push({
      name,
      path,
      isDir: false,
      modified: timestamp,
      created: timestamp,
      size,
      recentlyModified: true,
      recentlyCreated: true,
    });
    sortTree(tree);
    return;
  }

  // Nested: find parent directory
  const parentPath = parts.slice(0, -1).join("/");
  for (const node of tree) {
    if (node.path === parentPath && node.children) {
      if (!node.children.some((c) => c.path === path)) {
        node.children.push({
          name,
          path,
          isDir: false,
          modified: timestamp,
          created: timestamp,
          size,
          recentlyModified: true,
          recentlyCreated: true,
        });
        sortTree(node.children);
      }
      return;
    }
    if (node.children) {
      insertTreeNode(node.children, path, size, timestamp);
    }
  }
}

function updateTreeNode(tree: FileEntry[], path: string, timestamp: number) {
  for (const node of tree) {
    if (node.path === path) {
      node.modified = timestamp;
      node.recentlyModified = true;
      return;
    }
    if (node.children) {
      updateTreeNode(node.children, path, timestamp);
    }
  }
}

function removeTreeNode(tree: FileEntry[], path: string) {
  const idx = tree.findIndex((e) => e.path === path);
  if (idx !== -1) {
    tree.splice(idx, 1);
    return;
  }
  for (const node of tree) {
    if (node.children) {
      removeTreeNode(node.children, path);
    }
  }
}

function clearAnimationFlag(tree: FileEntry[], path: string) {
  for (const node of tree) {
    if (node.path === path) {
      node.recentlyModified = false;
      node.recentlyCreated = false;
      return;
    }
    if (node.children) {
      clearAnimationFlag(node.children, path);
    }
  }
}

function sortTree(entries: FileEntry[]) {
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}
