import { Router, Route } from "@solidjs/router";
import { createContext, useContext, createSignal, Show, onMount, onCleanup } from "solid-js";
import ThreePanel from "./layouts/ThreePanel";
import MobileLayout from "./layouts/MobileLayout";
import ChatPanel from "./components/chat/ChatPanel";
import SessionList from "./components/sessions/SessionList";
import FileTree from "./components/files/FileTree";
import EditorPanel from "./components/editor/EditorPanel";
import TaskPanel from "./components/tasks/TaskPanel";
import TeamsPanel from "./components/teams/TeamsPanel";
import CommandPalette from "./components/shared/CommandPalette";
import { useIsMobile } from "./hooks/useMediaQuery";
import { useKeymap, type KeyBinding } from "./shortcuts/keymap";
import { createSessionStore, type SessionStore } from "./stores/session";
import { TransportClient } from "./transport/client";
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
  let client: TransportClient | undefined;

  onMount(() => {
    const serverUrl = `https://${window.location.hostname}:4433`;
    client = new TransportClient({
      url: serverUrl,
      onEvent: (topic, envelope) => store.handleEvent(topic, envelope),
      onStatusChange: (status) => store.updateConnectionStatus(status),
      onTierChange: (tier) => store.updateQualityTier(tier),
    });
    client.connect();
  });

  onCleanup(() => {
    client?.disconnect();
  });

  return (
    <SessionContext.Provider value={store}>
      <Router>
        <Route path="/" component={Shell} />
        <Route path="/session/:id" component={Shell} />
      </Router>
    </SessionContext.Provider>
  );
}

function Shell() {
  const isMobile = useIsMobile();
  const [paletteOpen, setPaletteOpen] = createSignal(false);

  const commands = () => [
    { id: "new-session", label: "New Session", category: "Sessions", action: () => {}, shortcut: "\u2318N" },
    { id: "search-files", label: "Search Files", category: "Files", action: () => {} },
    { id: "toggle-profiler", label: "Toggle Profiler", category: "Settings", action: () => {} },
    { id: "settings", label: "Open Settings", category: "Settings", action: () => {} },
  ];

  useKeymap(() => [
    { key: "k", meta: true, description: "Command palette", action: () => setPaletteOpen(true) },
    { key: "Escape", description: "Close overlay", action: () => setPaletteOpen(false) },
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
            network={<SettingsPlaceholder label="Network" />}
            settings={<SettingsPlaceholder label="Settings" />}
          />
        }
      >
        <ThreePanel
          left={<SessionList />}
          center={<ChatPanel />}
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

function SettingsPlaceholder(props: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        height: "100%",
        color: "var(--ctp-overlay0)",
        "font-size": "14px",
      }}
    >
      {props.label}
    </div>
  );
}

function RightPanel() {
  const [selectedFile, setSelectedFile] = createSignal<string>("");
  const [rightTab, setRightTab] = createSignal<"files" | "tasks" | "teams">("files");

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          gap: "2px",
          padding: "4px 8px",
          "border-bottom": "1px solid var(--ctp-surface0)",
          background: "var(--ctp-mantle)",
        }}
      >
        <button
          onClick={() => setRightTab("files")}
          style={{
            padding: "3px 10px",
            background: rightTab() === "files" ? "var(--ctp-surface0)" : "transparent",
            border: "none",
            "border-radius": "4px",
            color: rightTab() === "files" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
            "font-size": "11px",
            cursor: "pointer",
          }}
        >
          Files
        </button>
        <button
          onClick={() => setRightTab("tasks")}
          style={{
            padding: "3px 10px",
            background: rightTab() === "tasks" ? "var(--ctp-surface0)" : "transparent",
            border: "none",
            "border-radius": "4px",
            color: rightTab() === "tasks" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
            "font-size": "11px",
            cursor: "pointer",
          }}
        >
          Tasks
        </button>
        <button
          onClick={() => setRightTab("teams")}
          style={{
            padding: "3px 10px",
            background: rightTab() === "teams" ? "var(--ctp-surface0)" : "transparent",
            border: "none",
            "border-radius": "4px",
            color: rightTab() === "teams" ? "var(--ctp-text)" : "var(--ctp-overlay0)",
            "font-size": "11px",
            cursor: "pointer",
          }}
        >
          Teams
        </button>
      </div>
      {rightTab() === "files" ? (
        <>
          <div style={{ "flex-shrink": "0", height: "40%", "border-bottom": "1px solid var(--ctp-surface0)", overflow: "hidden" }}>
            <FileTree onFileSelect={setSelectedFile} />
          </div>
          <div style={{ flex: "1", overflow: "hidden" }}>
            <EditorPanel filePath={selectedFile() || undefined} />
          </div>
        </>
      ) : rightTab() === "tasks" ? (
        <div style={{ flex: "1", overflow: "hidden" }}>
          <TaskPanel />
        </div>
      ) : (
        <div style={{ flex: "1", overflow: "hidden" }}>
          <TeamsPanel />
        </div>
      )}
    </div>
  );
}
