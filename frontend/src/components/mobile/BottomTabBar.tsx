import { For } from "solid-js";
import { useHaptic } from "../../hooks/useHaptic";

export type TabId = "chat" | "files" | "sessions" | "plan" | "network" | "settings";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const tabs: Tab[] = [
  { id: "chat", label: "Chat", icon: "M3 6h18v2H3zm0 5h12v2H3zm0 5h18v2H3z" },
  { id: "sessions", label: "Sessions", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zm0 4v6l4.5 2.5" },
  { id: "plan", label: "Plan", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { id: "network", label: "Network", icon: "M1 9l11 11L23 9M1 9l11 4 11-4" },
  { id: "settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zm7.94-2.06a1 1 0 00.2-1.1l-1-1.73a1 1 0 00-1.21-.45l-.3.13a8 8 0 00-1.5-.87V8a1 1 0 00-1-1h-2a1 1 0 00-1 1v.92a8 8 0 00-1.5.87l-.3-.13a1 1 0 00-1.21.45l-1 1.73a1 1 0 00.2 1.1l.8.65a8 8 0 000 1.74l-.8.65" },
];

export default function BottomTabBar(props: { activeTab: TabId; onTabChange: (tab: TabId) => void }) {
  const haptic = useHaptic();

  return (
    <nav
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "space-around",
        height: "56px",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
        background: "var(--ctp-mantle)",
        "border-top": "1px solid var(--ctp-surface0)",
        "flex-shrink": "0",
      }}
    >
      <For each={tabs}>
        {(tab) => {
          const isActive = () => props.activeTab === tab.id;
          return (
            <button
              data-testid={`tab-${tab.id}`}
              onClick={() => {
                haptic.tap();
                props.onTabChange(tab.id);
              }}
              style={{
                display: "flex",
                "flex-direction": "column",
                "align-items": "center",
                "justify-content": "center",
                gap: "2px",
                flex: "1",
                height: "44px",
                "min-width": "44px",
                background: "none",
                border: "none",
                color: isActive() ? "var(--ctp-blue)" : "var(--ctp-overlay0)",
                cursor: "pointer",
                padding: "4px 0",
                "-webkit-tap-highlight-color": "transparent",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={tab.icon} />
              </svg>
              <span style={{ "font-size": "10px", "font-weight": isActive() ? "600" : "400" }}>
                {tab.label}
              </span>
            </button>
          );
        }}
      </For>
    </nav>
  );
}
