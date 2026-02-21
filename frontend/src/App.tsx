import { Router, Route } from "@solidjs/router";
import { createContext, useContext, onMount, onCleanup } from "solid-js";
import ThreePanel from "./layouts/ThreePanel";
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
  const store = useSession();

  return (
    <div style={{ padding: "16px" }}>
      <h2
        style={{
          "font-size": "14px",
          "font-weight": "600",
          color: "var(--ctp-subtext1)",
          "text-transform": "uppercase",
          "letter-spacing": "0.05em",
          "margin-bottom": "12px",
        }}
      >
        Sessions
      </h2>
      <div
        style={{
          padding: "24px 16px",
          color: "var(--ctp-overlay1)",
          "font-size": "13px",
          "text-align": "center",
        }}
      >
        <div
          style={{
            width: "8px",
            height: "8px",
            "border-radius": "50%",
            background:
              store.state.connectionStatus === "connected"
                ? "var(--ctp-green)"
                : store.state.connectionStatus === "connecting"
                  ? "var(--ctp-yellow)"
                  : "var(--ctp-overlay0)",
            display: "inline-block",
            "margin-right": "8px",
          }}
        />
        {store.state.connectionStatus}
      </div>
    </div>
  );
}

function CenterPanel() {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        height: "100%",
        color: "var(--ctp-overlay1)",
        "flex-direction": "column",
        gap: "8px",
      }}
    >
      <div
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "24px",
          color: "var(--ctp-blue)",
        }}
      >
        noaide
      </div>
      <div style={{ "font-size": "13px" }}>Select a session to begin</div>
    </div>
  );
}

function RightPanel() {
  return (
    <div style={{ padding: "16px" }}>
      <h2
        style={{
          "font-size": "14px",
          "font-weight": "600",
          color: "var(--ctp-subtext1)",
          "text-transform": "uppercase",
          "letter-spacing": "0.05em",
          "margin-bottom": "12px",
        }}
      >
        Details
      </h2>
      <div
        style={{
          padding: "24px 16px",
          color: "var(--ctp-overlay1)",
          "font-size": "13px",
          "text-align": "center",
        }}
      >
        No active session
      </div>
    </div>
  );
}
