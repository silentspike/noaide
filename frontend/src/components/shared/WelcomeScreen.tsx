import { Show } from "solid-js";

interface WelcomeScreenProps {
  onDismiss: () => void;
}

/**
 * First-time welcome/onboarding overlay.
 * Shows once (tracked via localStorage), introduces key features.
 */
export default function WelcomeScreen(props: WelcomeScreenProps) {
  return (
    <div
      data-testid="welcome-screen"
      style={{
        position: "fixed",
        inset: "0",
        "z-index": "10001",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        background: "rgba(0,0,0,0.7)",
        "backdrop-filter": "blur(8px)",
      }}
    >
      <div style={{
        background: "var(--ctp-base)",
        border: "1px solid var(--ctp-surface1)",
        "border-radius": "16px",
        padding: "32px",
        "max-width": "480px",
        width: "90%",
        "box-shadow": "0 16px 64px rgba(0,0,0,0.5)",
        "text-align": "center",
      }}>
        <div style={{ "font-size": "32px", "margin-bottom": "12px" }}>noaide</div>
        <p style={{
          color: "var(--ctp-subtext0)",
          "font-size": "13px",
          "line-height": "1.6",
          margin: "0 0 20px",
        }}>
          Real-time IDE for Claude Code, Codex, and Gemini CLI sessions.
          Watch your AI agents work live — every message, tool call, and file change.
        </p>

        <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "text-align": "left", "margin-bottom": "24px" }}>
          <Feature icon="&#9638;" label="Kanban Board" desc="Drag WPs across TOGAF ADM phases" />
          <Feature icon="&#128269;" label="Full Transparency" desc="See hidden messages, system prompts, thinking" />
          <Feature icon="&#9881;" label="API Intercept" desc="Inspect and modify LLM API calls in flight" />
          <Feature icon="&#127911;" label="Voice Input" desc="Speak to your sessions via Whisper" />
        </div>

        <div style={{ display: "flex", gap: "8px", "justify-content": "center" }}>
          <button
            data-testid="welcome-dismiss"
            onClick={() => {
              localStorage.setItem("noaide-welcomed", "true");
              props.onDismiss();
            }}
            style={{
              padding: "10px 24px",
              background: "var(--neon-green, #00ff9d)",
              color: "var(--ctp-base)",
              border: "none",
              "border-radius": "8px",
              "font-size": "13px",
              "font-weight": "700",
              cursor: "pointer",
            }}
          >
            Get Started
          </button>
          <button
            onClick={() => {
              localStorage.setItem("noaide-welcomed", "true");
              props.onDismiss();
            }}
            style={{
              padding: "10px 16px",
              background: "var(--ctp-surface0)",
              color: "var(--ctp-subtext0)",
              border: "none",
              "border-radius": "8px",
              "font-size": "12px",
              cursor: "pointer",
            }}
          >
            Press ? for shortcuts
          </button>
        </div>
      </div>
    </div>
  );
}

function Feature(props: { icon: string; label: string; desc: string }) {
  return (
    <div style={{ display: "flex", gap: "10px", "align-items": "center" }}>
      <span style={{ "font-size": "16px", width: "24px", "text-align": "center", "flex-shrink": "0" }}>{props.icon}</span>
      <div>
        <div style={{ "font-size": "12px", "font-weight": "600", color: "var(--ctp-text)" }}>{props.label}</div>
        <div style={{ "font-size": "10px", color: "var(--ctp-overlay0)" }}>{props.desc}</div>
      </div>
    </div>
  );
}
