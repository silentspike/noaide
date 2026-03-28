import { createSignal, For, onCleanup, onMount, type JSX } from "solid-js";
import { useHaptic } from "../../hooks/useHaptic";

interface SwipeViewProps {
  children: JSX.Element[];
  activeIndex: number;
  onIndexChange: (index: number) => void;
}

export default function SwipeView(props: SwipeViewProps) {
  let containerRef: HTMLDivElement | undefined;
  const haptic = useHaptic();

  const [startX, setStartX] = createSignal(0);
  const [currentX, setCurrentX] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);

  const SWIPE_THRESHOLD = 50;
  const VELOCITY_THRESHOLD = 0.3;
  const LOCK_THRESHOLD = 12;

  let startTime = 0;
  let startY = 0;
  let locked = false;

  // These are only attached AFTER horizontal lock — zero overhead during vertical scroll
  const handleLockedMove = (e: TouchEvent) => {
    setCurrentX(e.touches[0].clientX);
  };

  const handleLockedEnd = () => {
    cleanup();
    setIsDragging(false);

    const diff = currentX() - startX();
    const elapsed = Date.now() - startTime;
    const velocity = Math.abs(diff) / elapsed;
    const count = props.children.length;

    if (Math.abs(diff) > SWIPE_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
      if (diff > 0 && props.activeIndex > 0) {
        haptic.swipeComplete();
        props.onIndexChange(props.activeIndex - 1);
      } else if (diff < 0 && props.activeIndex < count - 1) {
        haptic.swipeComplete();
        props.onIndexChange(props.activeIndex + 1);
      }
    }

    setCurrentX(startX());
  };

  function cleanup() {
    const el = containerRef;
    if (!el || !locked) return;
    el.removeEventListener("touchmove", handleLockedMove);
    el.removeEventListener("touchend", handleLockedEnd);
    locked = false;
  }

  // Lightweight probe — only checks direction, no signals, no transforms
  const handleProbeMove = (e: TouchEvent) => {
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = Math.abs(x - startX());
    const dy = Math.abs(y - startY);

    if (dx < LOCK_THRESHOLD && dy < LOCK_THRESHOLD) return;

    // Remove probe immediately — one-shot
    containerRef!.removeEventListener("touchmove", handleProbeMove);
    containerRef!.removeEventListener("touchend", handleProbeEnd);

    if (dx > dy * 1.2) {
      // Horizontal confirmed — attach real handlers
      locked = true;
      setIsDragging(true);
      setCurrentX(x);
      containerRef!.addEventListener("touchmove", handleLockedMove, { passive: true });
      containerRef!.addEventListener("touchend", handleLockedEnd, { passive: true });
    }
    // Vertical: do nothing — browser handles native scroll with zero JS overhead
  };

  const handleProbeEnd = () => {
    containerRef!.removeEventListener("touchmove", handleProbeMove);
    containerRef!.removeEventListener("touchend", handleProbeEnd);
  };

  const handleTouchStart = (e: TouchEvent) => {
    cleanup();
    setStartX(e.touches[0].clientX);
    setCurrentX(e.touches[0].clientX);
    startY = e.touches[0].clientY;
    startTime = Date.now();

    // Attach lightweight probe — removed after first direction decision
    containerRef!.addEventListener("touchmove", handleProbeMove, { passive: true });
    containerRef!.addEventListener("touchend", handleProbeEnd, { passive: true });
  };

  onMount(() => {
    const el = containerRef;
    if (!el) return;
    el.addEventListener("touchstart", handleTouchStart, { passive: true });

    onCleanup(() => {
      el.removeEventListener("touchstart", handleTouchStart);
      cleanup();
      el.removeEventListener("touchmove", handleProbeMove);
      el.removeEventListener("touchend", handleProbeEnd);
    });
  });

  const dragOffset = () => {
    if (!isDragging()) return 0;
    return currentX() - startX();
  };

  return (
    <div
      ref={containerRef}
      style={{
        flex: "1",
        overflow: "hidden",
        position: "relative",
        "touch-action": "pan-y",
      }}
    >
      <div
        style={{
          display: "flex",
          height: "100%",
          transform: `translateX(calc(-${props.activeIndex * 100}% + ${dragOffset()}px))`,
          transition: isDragging() ? "none" : "transform 0.3s ease-out",
          ...(isDragging() ? { "will-change": "transform" } : {}),
        }}
      >
        <For each={props.children}>{(child) => (
          <div
            style={{
              "min-width": "100%",
              height: "100%",
              overflow: "auto",
              "touch-action": "pan-y",
              "-webkit-overflow-scrolling": "touch",
              "overscroll-behavior-y": "contain",
            }}
          >
            {child}
          </div>
        )}</For>
      </div>
    </div>
  );
}
