import { Router, Route } from "@solidjs/router";
import { createContext, useContext, createSignal, onMount, onCleanup } from "solid-js";
import ThreePanel from "./layouts/ThreePanel";
import ChatPanel from "./components/chat/ChatPanel";
import SessionList from "./components/sessions/SessionList";
import FileTree from "./components/files/FileTree";
import EditorPanel from "./components/editor/EditorPanel";
import TaskPanel from "./components/tasks/TaskPanel";
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
  return (
    <ThreePanel
      left={<LeftPanel />}
      center={<CenterPanel />}
      right={<RightPanel />}
    />
  );
}

function LeftPanel() {
  return <SessionList />;
}

function CenterPanel() {
  return <ChatPanel />;
}

function RightPanel() {
  const [selectedFile, setSelectedFile] = createSignal<string>("");
  const [rightTab, setRightTab] = createSignal<"files" | "tasks">("files");

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
      ) : (
        <div style={{ flex: "1", overflow: "hidden" }}>
          <TaskPanel />
        </div>
      )}
    </div>
  );
}
