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
import BranchSelector from "./components/git/BranchSelector";
import StagingArea from "./components/git/StagingArea";
import CommitHistory from "./components/git/CommitHistory";
import CommandPalette from "./components/shared/CommandPalette";
import { useIsMobile } from "./hooks/useMediaQuery";
import { useKeymap, type KeyBinding } from "./shortcuts/keymap";
import { createSessionStore, type SessionStore } from "./stores/session";
import { TransportClient } from "./transport/client";
import { setDecompressor } from "./transport/codec";
import { decompress as fzstdDecompress } from "fzstd";
import "./styles/tokens.css";
import "./styles/global.css";

const SessionContext = createContext<SessionStore>();

export function useSession(): SessionStore {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within App");
  return ctx;
}

export default function App() {
  const store = createSessionStore();
  // Expose store for Playwright E2E testing / debugging
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__noaide_store = store;
  let client: TransportClient | undefined;

  onMount(() => {
    // Initialize Zstd decompressor (pure JS fallback until WASM is built)
    setDecompressor((data: Uint8Array) => fzstdDecompress(data));

    const host = window.location.hostname;
    const httpApiUrl = `http://${host}:8080`;
    const serverUrl = `https://${host}:4433`;

    // Set HTTP API URL for store to fetch sessions/messages
    store.setHttpApiUrl(httpApiUrl);

    client = new TransportClient({
      url: serverUrl,
      onEvent: (topic, envelope) => store.handleEvent(topic, envelope),
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
      <Router base="/noaide">
        <Route path="/" component={Shell} />
        <Route path="/session/:id" component={Shell} />
      </Router>
    </SessionContext.Provider>
  );
}

// --- Center Tab Definitions ---

type CenterTabId = "chat" | "editor" | "network" | "teams" | "gallery" | "tasks" | "git" | "settings" | "profiler";

interface TabDef {
  id: CenterTabId;
  label: string;
  shortcut: string;
}

const CENTER_TABS: TabDef[] = [
  { id: "chat", label: "Chat", shortcut: "1" },
  { id: "editor", label: "Editor", shortcut: "2" },
  { id: "network", label: "Network", shortcut: "3" },
  { id: "teams", label: "Teams", shortcut: "4" },
  { id: "gallery", label: "Gallery", shortcut: "5" },
  { id: "tasks", label: "Tasks", shortcut: "6" },
  { id: "git", label: "Git", shortcut: "7" },
  { id: "settings", label: "Settings", shortcut: "8" },
];

// --- Shell ---

function Shell() {
  const isMobile = useIsMobile();
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [centerTab, setCenterTab] = createSignal<CenterTabId>("chat");

  const commands = () => [
    { id: "new-session", label: "New Session", category: "Sessions", action: () => {}, shortcut: "\u2318N" },
    { id: "search-files", label: "Search Files", category: "Files", action: () => {} },
    { id: "toggle-profiler", label: "Toggle Profiler", category: "Settings", action: () => setCenterTab("profiler") },
    { id: "settings", label: "Open Settings", category: "Settings", action: () => setCenterTab("settings") },
    ...CENTER_TABS.map((t) => ({
      id: `tab-${t.id}`,
      label: `Show ${t.label}`,
      category: "Tabs",
      action: () => setCenterTab(t.id),
      shortcut: `\u2318${t.shortcut}`,
    })),
  ];

  useKeymap(() => [
    { key: "k", meta: true, description: "Command palette", action: () => setPaletteOpen(true) },
    { key: "Escape", description: "Close overlay", action: () => setPaletteOpen(false) },
    // Tab shortcuts: Cmd/Ctrl + 1-7
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
  const [selectedFile, setSelectedFile] = createSignal<string>("");

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

      {/* Tab Content */}
      <div style={{ flex: "1", "min-height": "0", overflow: "hidden" }}>
        <Show when={props.activeTab === "chat"}>
          <ChatPanel />
        </Show>
        <Show when={props.activeTab === "editor"}>
          <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
            <div style={{ "flex-shrink": "0", height: "35%", "border-bottom": "1px solid var(--ctp-surface0)", overflow: "hidden" }}>
              <FileTree onFileSelect={setSelectedFile} />
            </div>
            <div style={{ flex: "1", overflow: "hidden" }}>
              <EditorPanel filePath={selectedFile() || undefined} />
            </div>
          </div>
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
  const [selectedFile, setSelectedFile] = createSignal<string>("");
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div style={{ "flex-shrink": "0", height: "40%", "border-bottom": "1px solid var(--ctp-surface0)", overflow: "hidden" }}>
        <FileTree onFileSelect={setSelectedFile} />
      </div>
      <div style={{ flex: "1", overflow: "hidden" }}>
        <EditorPanel filePath={selectedFile() || undefined} />
      </div>
    </div>
  );
}

// --- Right Panel ---

function RightPanel() {
  const [selectedFile, setSelectedFile] = createSignal<string>("");
  const [rightTab, setRightTab] = createSignal<"files" | "tasks" | "teams">("files");

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
                <FileTree onFileSelect={setSelectedFile} />
              </div>
              <div style={{ flex: "1", overflow: "hidden" }}>
                <EditorPanel filePath={selectedFile() || undefined} />
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
