import { createSignal, onMount, onCleanup, type JSX } from "solid-js";
import BottomTabBar, { type TabId } from "../components/mobile/BottomTabBar";
import SwipeView from "../components/mobile/SwipeView";

interface MobileLayoutProps {
  chat: JSX.Element;
  files: JSX.Element;
  sessions: JSX.Element;
  plan: JSX.Element;
  network: JSX.Element;
  settings: JSX.Element;
}

const tabOrder: TabId[] = ["chat", "sessions", "plan", "network", "settings"];

export default function MobileLayout(props: MobileLayoutProps) {
  const [activeTab, setActiveTab] = createSignal<TabId>("chat");

  const activeIndex = () => tabOrder.indexOf(activeTab());

  const handleIndexChange = (index: number) => {
    setActiveTab(tabOrder[index]);
  };

  // Listen for tab navigation events (e.g. session tap → switch to chat)
  onMount(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail as TabId;
      if (tabOrder.includes(tab)) setActiveTab(tab);
    };
    window.addEventListener("noaide:navigate-tab", handler);
    onCleanup(() => window.removeEventListener("noaide:navigate-tab", handler));
  });

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
          props.sessions,
          props.plan,
          props.network,
          props.settings,
        ]}
      </SwipeView>

      <BottomTabBar
        activeTab={activeTab()}
        onTabChange={setActiveTab}
      />
    </div>
  );
}
