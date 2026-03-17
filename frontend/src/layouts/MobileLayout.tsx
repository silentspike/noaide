import { createSignal, Show, onMount, onCleanup, type JSX } from "solid-js";
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
  const [pullRefreshing, setPullRefreshing] = createSignal(false);

  // Pull-to-refresh: detect vertical pull when scrolled to top
  let pullStartY = 0;
  const handleTouchStart = (e: TouchEvent) => { pullStartY = e.touches[0].clientY; };
  const handleTouchEnd = (e: TouchEvent) => {
    const pullDist = e.changedTouches[0].clientY - pullStartY;
    if (pullDist > 100 && window.scrollY <= 0) {
      setPullRefreshing(true);
      window.dispatchEvent(new CustomEvent("noaide:refresh"));
      setTimeout(() => setPullRefreshing(false), 1500);
    }
  };

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
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--ctp-base)",
      }}
    >
      <Show when={pullRefreshing()}>
        <div data-testid="pull-to-refresh" style={{
          "text-align": "center", padding: "8px", "font-size": "10px",
          color: "var(--ctp-blue)", background: "var(--ctp-mantle)",
        }}>
          Refreshing...
        </div>
      </Show>
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
