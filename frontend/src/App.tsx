import { Router, Route } from "@solidjs/router";
import { createContext, useContext, createSignal, Show, For, onMount, onCleanup } from "solid-js";
import ThreePanel from "./layouts/ThreePanel";
import MobileLayout from "./layouts/MobileLayout";
import ChatPanel from "./components/chat/ChatPanel";
import SessionList from "./components/sessions/SessionList";
import FileTree from "./components/files/FileTree";
import EditorPanel from "./components/editor/EditorPanel";
import TaskPanel from "./components/tasks/TaskPanel";
import TeamsPanel from "./components/teams/TeamsPanel";
import NetworkPanel from "./components/network/NetworkPanel";
import GalleryPanel from "./components/gallery/GalleryPanel";
import SettingsPanel from "./components/settings/SettingsPanel";
import ProfilerPanel from "./components/profiler/ProfilerPanel";
import CostDashboard from "./components/cost/CostDashboard";
import { PlanSelector } from "./components/togaf/PlanSelector";
import BranchSelector from "./components/git/BranchSelector";
import StagingArea from "./components/git/StagingArea";
import CommitHistory from "./components/git/CommitHistory";
import CommandPalette from "./components/shared/CommandPalette";
import ToastContainer from "./components/shared/ToastContainer";
import KeyboardShortcutsHelp from "./components/shared/KeyboardShortcutsHelp";
import WelcomeScreen from "./components/shared/WelcomeScreen";
import PanelErrorBoundary from "./components/shared/ErrorBoundary";
import Breadcrumb from "./components/shared/Breadcrumb";
import { useIsMobile } from "./hooks/useMediaQuery";
import { useKeymap, type KeyBinding } from "./shortcuts/keymap";
import { createSessionStore, type SessionStore } from "./stores/session";
import { createFileStore, type FileStore } from "./stores/file";
import { TransportClient } from "./transport/client";
import { setDecompressor } from "./transport/codec";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { decompress as fzstdDecompress } from "fzstd";
import "./styles/tokens.css";
import "./styles/global.css";

const SessionContext = createContext<SessionStore>();
const FileContext = createContext<FileStore>();

export function useSession(): SessionStore {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    // During SolidJS HMR boundary re-evaluation, context may not be available.
    // Return a safe no-op store instead of throwing to prevent cascading errors.
    console.warn("useSession called outside SessionContext (likely HMR boundary)");
    return createNullStore();
  }
  return ctx;
}

export function useFiles(): FileStore {
  const ctx = useContext(FileContext);
  if (!ctx) throw new Error("useFiles called outside FileContext");
  return ctx;
}

function createNullStore(): SessionStore {
  return {
    state: {
      sessions: [],
      activeSessionId: null,
      connectionStatus: "disconnected" as const,
      qualityTier: "Full" as const,
      messages: [],
      orbState: "idle" as const,
      activeModel: null,
      contextTokensUsed: 0,
      contextTokensMax: 200_000,
      httpApiUrl: null,
      loadingProgress: {
        loading: false,
        bytesLoaded: 0,
        bytesTotal: 0,
        startTime: 0,
        messagesExpected: 0,
      },
    },
    activeSession: () => null,
    activeSessions: () => [],
    sessionCount: () => 0,
    activeMessages: () => [],
    totalSessionCost: () => 0,
    sessionsVersion: () => 0,
    messagesVersion: () => 0,
    setHttpApiUrl: () => {},
    fetchSessions: async () => {},
    fetchMessages: async () => {},
    setActiveSession: () => {},
    updateConnectionStatus: () => {},
    updateQualityTier: () => {},
    updateOrbState: () => {},
    upsertSession: () => {},
    removeSession: () => {},
    addMessage: () => {},
    addOptimisticUserMessage: () => {},
    handleEvent: () => {},
  } as unknown as SessionStore;
}

export default function App() {
  const store = createSessionStore();
  const fileStore = createFileStore(store);
  // Expose stores for Playwright E2E testing / debugging
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__noaide_store = store;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__noaide_files = fileStore;
  let client: TransportClient | undefined;

  onMount(() => {
    // Initialize Zstd decompressor (pure JS fallback until WASM is built)
    setDecompressor((data: Uint8Array) => fzstdDecompress(data));

    const host = window.location.hostname;
    // Use same origin for API calls — Vite proxies /api/* to backend port 8080
    // This avoids mixed content (http from https page) on LAN/mobile
    const httpApiUrl = window.location.origin;
    const serverUrl = `https://${host}:4433`;

    // Set HTTP API URL for store to fetch sessions/messages
    store.setHttpApiUrl(httpApiUrl);

    client = new TransportClient({
      url: serverUrl,
      onEvent: (topic, envelope) => {
        store.handleEvent(topic, envelope);
        if (topic === "files/changes" && envelope.payload) {
          try {
            // Payload is MessagePack (Hot Path, NOT JSON!)
            const payload = msgpackDecode(envelope.payload) as Record<string, unknown>;
            fileStore.handleFileChangeEvent({
              path: payload.path as string,
              kind: payload.kind as "created" | "modified" | "deleted",
              pid: (payload.pid as number) ?? null,
              session_id: payload.session_id as string,
              project_root: (payload.project_root as string) ?? "",
              timestamp: payload.timestamp as number,
              content: (payload.content as string) ?? null,
              size: (payload.size as number) ?? null,
            });
          } catch (e) {
            console.warn("[files/changes] failed to decode msgpack payload:", e);
          }
        }
      },
      onStatusChange: (status) => {
        store.updateConnectionStatus(status);
        if (status === "connected") {
          store.fetchSessions();
        }
      },
      onTierChange: (tier) => store.updateQualityTier(tier),
    });
    client.connect();

    // Fetch sessions immediately via HTTP (doesn't need WebTransport)
    store.fetchSessions();
    // Poll for sessions periodically (keeps timestamps and sort order fresh)
    const pollInterval = setInterval(() => store.fetchSessions(), 5000);
    onCleanup(() => clearInterval(pollInterval));
  });

  onCleanup(() => {
    client?.disconnect();
  });

  return (
    <SessionContext.Provider value={store}>
      <FileContext.Provider value={fileStore}>
        <Router base="/noaide">
          <Route path="/" component={Shell} />
          <Route path="/session/:id" component={Shell} />
        </Router>
        <ToastContainer />
        <KeyboardShortcutsHelp />
        {(() => {
          const [showWelcome, setShowWelcome] = createSignal(
            !localStorage.getItem("noaide-welcomed")
          );
          return (
            <Show when={showWelcome()}>
              <WelcomeScreen onDismiss={() => setShowWelcome(false)} />
            </Show>
          );
        })()}
      </FileContext.Provider>
    </SessionContext.Provider>
  );
}

// --- Center Tab Definitions ---

type CenterTabId = "chat" | "network" | "teams" | "gallery" | "tasks" | "plan" | "git" | "cost" | "settings" | "profiler";

interface TabDef {
  id: CenterTabId;
  label: string;
  shortcut: string;
}

const CENTER_TABS: TabDef[] = [
  { id: "chat", label: "Chat", shortcut: "1" },
  { id: "network", label: "Network", shortcut: "2" },
  { id: "teams", label: "Teams", shortcut: "3" },
  { id: "gallery", label: "Gallery", shortcut: "4" },
  { id: "tasks", label: "Tasks", shortcut: "5" },
  { id: "plan", label: "Plan", shortcut: "6" },
  { id: "git", label: "Git", shortcut: "7" },
  { id: "cost", label: "Cost", shortcut: "8" },
  { id: "settings", label: "Settings", shortcut: "9" },
];

function tabIcon(id: string): string {
  switch (id) {
    case "chat": return "\u2026";
    case "network": return "\u21C4";
    case "teams": return "\u2302";
    case "gallery": return "\u25A3";
    case "tasks": return "\u2610";
    case "git": return "\u2387";
    case "cost": return "\u2696";
    case "settings": return "\u2699";
    case "plan": return "\u25A3";
    case "profiler": return "\u26A1";
    default: return "\u25CF";
  }
}

// --- Shell ---

function Shell() {
  const isMobile = useIsMobile();
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [centerTab, setCenterTab] = createSignal<CenterTabId>("chat");

  const store = useSession();
  const isMac2 = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac2 ? "\u2318" : "Ctrl+";

  const commands = () => {
    const cmds = [
      { id: "search-chat", label: "Search in Chat", category: "Commands", action: () => { /* Cmd+F dispatched */ document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: !isMac2, metaKey: isMac2 })); }, shortcut: `${mod}F`, icon: "\u2315" },
      { id: "toggle-profiler", label: "Toggle Profiler", category: "Commands", action: () => setCenterTab("profiler"), icon: "\u26A1" },
      { id: "export-session", label: "Export Session", category: "Commands", action: () => { setCenterTab("chat"); /* trigger via store event */ }, icon: "\u2B07" },
      { id: "settings", label: "Open Settings", category: "Commands", action: () => setCenterTab("settings"), icon: "\u2699" },
      ...CENTER_TABS.map((t) => ({
        id: `tab-${t.id}`,
        label: t.label,
        category: "Tabs",
        action: () => setCenterTab(t.id),
        shortcut: `${mod}${t.shortcut}`,
        icon: tabIcon(t.id),
      })),
    ];

    // Dynamic session entries
    const sessions = store.state.sessions;
    for (const s of sessions.slice(0, 15)) {
      const name = s.path.split("/").filter(Boolean).pop() ?? s.id.slice(0, 8);
      cmds.push({
        id: `session-${s.id}`,
        label: name,
        category: "Sessions",
        action: () => store.setActiveSession(s.id),
        icon: s.cliType === "gemini" ? "\u2666" : s.cliType === "codex" ? "\u25C6" : "\u25CF",
      });
    }

    return cmds;
  };

  // Vim-style scroll helper
  const scrollChat = (dir: "up" | "down" | "top" | "bottom") => {
    const scroller = document.querySelector(".chat-canvas [style*=overflow]") as HTMLElement;
    if (!scroller) return;
    switch (dir) {
      case "up": scroller.scrollBy({ top: -120, behavior: "smooth" }); break;
      case "down": scroller.scrollBy({ top: 120, behavior: "smooth" }); break;
      case "top": scroller.scrollTo({ top: 0, behavior: "smooth" }); break;
      case "bottom": scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" }); break;
    }
  };

  useKeymap(() => [
    { key: "k", meta: true, description: "Command palette", action: () => setPaletteOpen(true) },
    { key: "Escape", description: "Close overlay", action: () => setPaletteOpen(false) },
    // Vim-style navigation (j/k/g/G when not in input)
    { key: "j", description: "Scroll down", action: () => scrollChat("down") },
    { key: "k", description: "Scroll up", action: () => scrollChat("up") },
    { key: "g", description: "Scroll to top", action: () => scrollChat("top") },
    { key: "G", shift: true, description: "Scroll to bottom", action: () => scrollChat("bottom") },
    // Tab shortcuts: Cmd/Ctrl + 1-8
    ...CENTER_TABS.map((t) => ({
      key: t.shortcut,
      meta: true,
      description: `Switch to ${t.label}`,
      action: () => setCenterTab(t.id),
    })),
  ] as KeyBinding[]);

  return (
    <>
      <Show
        when={!isMobile()}
        fallback={
          <MobileLayout
            chat={<ChatPanel />}
            files={<FilesPanel />}
            sessions={<SessionList />}
            plan={<PlanSelector />}
            network={<NetworkPanel />}
            settings={<SettingsPanel />}
          />
        }
      >
        <ThreePanel
          left={<SessionList />}
          center={<CenterPanel activeTab={centerTab()} onTabChange={setCenterTab} />}
          right={<RightPanel />}
        />
      </Show>
      <CommandPalette
        open={paletteOpen()}
        onClose={() => setPaletteOpen(false)}
        items={commands()}
      />
    </>
  );
}

// --- Center Panel with Tabs ---

function CenterPanel(props: { activeTab: CenterTabId; onTabChange: (tab: CenterTabId) => void }) {
  const sessionStore = useSession();
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      {/* Tab Bar */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "1px",
          padding: "0 8px",
          background: "rgba(14,14,24,0.88)",
          "backdrop-filter": "blur(16px)",
          "-webkit-backdrop-filter": "blur(16px)",
          "border-bottom": "1px solid var(--ctp-surface1)",
          "min-height": "32px",
          "flex-shrink": "0",
        }}
      >
        <For each={CENTER_TABS}>
          {(tab) => (
            <button
              data-testid={`tab-${tab.id}`}
              onClick={() => props.onTabChange(tab.id)}
              style={{
                padding: "6px 12px",
                background: props.activeTab === tab.id ? "rgba(0,184,255,0.06)" : "transparent",
                border: "none",
                "border-bottom": props.activeTab === tab.id
                  ? "2px solid var(--neon-blue, #00b8ff)"
                  : "2px solid transparent",
                color: props.activeTab === tab.id ? "var(--bright, #f0f0f5)" : "var(--dim, #68687a)",
                "font-size": "10px",
                "font-weight": "700",
                "font-family": "var(--font-mono)",
                "text-transform": "uppercase",
                "letter-spacing": "0.08em",
                cursor: "pointer",
                transition: "color 200ms ease, border-color 200ms ease, background 200ms ease",
                "white-space": "nowrap",
              }}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>

      {/* Breadcrumb navigation */}
      <Breadcrumb items={[
        { label: "noaide", onClick: () => props.onTabChange("chat") },
        { label: CENTER_TABS.find((t) => t.id === props.activeTab)?.label ?? props.activeTab },
      ]} />

      {/* Tab Content */}
      <div style={{ flex: "1", "min-height": "0", overflow: "hidden" }}>
        <Show when={props.activeTab === "chat"}>
          <ChatPanel />
        </Show>
        <Show when={props.activeTab === "network"}>
          <NetworkPanel />
        </Show>
        <Show when={props.activeTab === "teams"}>
          <TeamsPanel />
        </Show>
        <Show when={props.activeTab === "gallery"}>
          <GalleryPanel />
        </Show>
        <Show when={props.activeTab === "tasks"}>
          <TaskPanel />
        </Show>
        <Show when={props.activeTab === "plan"}>
          <PlanSelector sessionId={sessionStore.state.activeSessionId ?? undefined} />
        </Show>
        <Show when={props.activeTab === "git"}>
          <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "auto" }}>
            <div style={{ padding: "8px", "border-bottom": "1px solid var(--ctp-surface0)" }}>
              <BranchSelector />
            </div>
            <div style={{ padding: "8px", "border-bottom": "1px solid var(--ctp-surface0)" }}>
              <StagingArea />
            </div>
            <div style={{ flex: "1", overflow: "auto", padding: "8px" }}>
              <CommitHistory />
            </div>
          </div>
        </Show>
        <Show when={props.activeTab === "cost"}>
          <CostDashboard />
        </Show>
        <Show when={props.activeTab === "settings"}>
          <SettingsPanel />
        </Show>
        <Show when={props.activeTab === "profiler"}>
          <ProfilerPanel />
        </Show>
      </div>
    </div>
  );
}

// --- Files Panel (for Editor tab + Mobile) ---

function FilesPanel() {
  const files = useFiles();
  const store = useSession();
  const handleSave = async (content: string) => {
    const sid = store.state.activeSessionId;
    const path = files.selectedFile();
    if (!sid || !path) return false;
    return files.saveFile(sid, path, content);
  };
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div style={{ "flex-shrink": "0", height: "40%", "border-bottom": "1px solid var(--ctp-surface0)", overflow: "hidden" }}>
        <FileTree onFileSelect={(p) => files.selectFile(p)} />
      </div>
      <div style={{ flex: "1", overflow: "hidden" }}>
        <EditorPanel filePath={files.selectedFile() || undefined} content={files.state.fileContent ?? undefined} onSave={handleSave} />
      </div>
    </div>
  );
}

// --- Right Panel ---

function RightPanel() {
  const files = useFiles();
  const sessionStore = useSession();
  const [rightTab, setRightTab] = createSignal<"files" | "tasks" | "teams">("files");
  const handleSave = async (content: string) => {
    const sid = sessionStore.state.activeSessionId;
    const path = files.selectedFile();
    if (!sid || !path) return false;
    return files.saveFile(sid, path, content);
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          gap: "1px",
          padding: "0 8px",
          "border-bottom": "1px solid var(--ctp-surface1)",
          background: "rgba(14,14,24,0.88)",
          "backdrop-filter": "blur(16px)",
          "-webkit-backdrop-filter": "blur(16px)",
          "min-height": "32px",
          "align-items": "center",
        }}
      >
        <For each={["files", "tasks", "teams"] as const}>
          {(tab) => (
            <button
              onClick={() => setRightTab(tab)}
              style={{
                padding: "6px 10px",
                background: rightTab() === tab ? "rgba(0,184,255,0.06)" : "transparent",
                border: "none",
                "border-bottom": rightTab() === tab
                  ? "2px solid var(--neon-blue, #00b8ff)"
                  : "2px solid transparent",
                color: rightTab() === tab ? "var(--bright, #f0f0f5)" : "var(--dim, #68687a)",
                "font-size": "10px",
                "font-weight": "700",
                "font-family": "var(--font-mono)",
                "text-transform": "uppercase",
                "letter-spacing": "0.08em",
                cursor: "pointer",
                transition: "color 200ms ease, border-color 200ms ease, background 200ms ease",
              }}
            >
              {tab}
            </button>
          )}
        </For>
      </div>
      <div style={{ flex: "1", "min-height": "0", overflow: "hidden" }}>
        {rightTab() === "files" ? (
          <>
            <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
              <div style={{ "flex-shrink": "0", height: "40%", "border-bottom": "1px solid var(--ctp-surface0)", overflow: "hidden" }}>
                <FileTree onFileSelect={(p) => files.selectFile(p)} />
              </div>
              <div style={{ flex: "1", overflow: "hidden" }}>
                <EditorPanel filePath={files.selectedFile() || undefined} content={files.state.fileContent ?? undefined} onSave={handleSave} />
              </div>
            </div>
          </>
        ) : rightTab() === "tasks" ? (
          <TaskPanel />
        ) : (
          <TeamsPanel />
        )}
      </div>
    </div>
  );
}
