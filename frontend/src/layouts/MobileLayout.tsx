import { createSignal, type JSX } from "solid-js";
import BottomTabBar, { type TabId } from "../components/mobile/BottomTabBar";
import SwipeView from "../components/mobile/SwipeView";
import VoiceInput from "../components/mobile/VoiceInput";

interface MobileLayoutProps {
  chat: JSX.Element;
  files: JSX.Element;
  sessions: JSX.Element;
  network: JSX.Element;
  settings: JSX.Element;
}

const tabOrder: TabId[] = ["chat", "files", "sessions", "network", "settings"];

export default function MobileLayout(props: MobileLayoutProps) {
  const [activeTab, setActiveTab] = createSignal<TabId>("chat");

  const activeIndex = () => tabOrder.indexOf(activeTab());

  const handleIndexChange = (index: number) => {
    setActiveTab(tabOrder[index]);
  };

  const handleVoiceTranscript = (text: string) => {
    // Switch to chat tab and insert transcript
    setActiveTab("chat");
    // Dispatch custom event for ChatPanel to pick up
    window.dispatchEvent(
      new CustomEvent("noaide:voice-transcript", { detail: text }),
    );
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--ctp-base)",
      }}
    >
      <SwipeView
        activeIndex={activeIndex()}
        onIndexChange={handleIndexChange}
      >
        {[
          props.chat,
          props.files,
          props.sessions,
          props.network,
          props.settings,
        ]}
      </SwipeView>

      <VoiceInput onTranscript={handleVoiceTranscript} />

      <BottomTabBar
        activeTab={activeTab()}
        onTabChange={setActiveTab}
      />
    </div>
  );
}
