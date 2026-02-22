import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
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

  let startTime = 0;

  const handleTouchStart = (e: TouchEvent) => {
    setStartX(e.touches[0].clientX);
    setCurrentX(e.touches[0].clientX);
    setIsDragging(true);
    startTime = Date.now();
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging()) return;
    setCurrentX(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!isDragging()) return;
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

  onMount(() => {
    const el = containerRef;
    if (!el) return;
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });

    onCleanup(() => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
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
          "will-change": "transform",
        }}
      >
        <For each={props.children}>{(child) => (
          <div
            style={{
              "min-width": "100%",
              height: "100%",
              overflow: "auto",
            }}
          >
            {child}
          </div>
        )}</For>
      </div>
    </div>
  );
}
