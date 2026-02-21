import {
  createSignal,
  createEffect,
  onCleanup,
  For,
  type JSX,
} from "solid-js";

interface VirtualScrollerProps<T> {
  items: T[];
  estimateHeight: number;
  overscan?: number;
  renderItem: (item: T, index: number) => JSX.Element;
  onScrollNearBottom?: () => void;
}

export default function VirtualScroller<T>(props: VirtualScrollerProps<T>) {
  let containerRef: HTMLDivElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);
  const [userScrolled, setUserScrolled] = createSignal(false);

  const measuredHeights = new Map<number, number>();
  let prevItemCount = 0;

  function getItemHeight(index: number): number {
    return measuredHeights.get(index) ?? props.estimateHeight;
  }

  function getItemTop(index: number): number {
    let top = 0;
    for (let i = 0; i < index; i++) {
      top += getItemHeight(i);
    }
    return top;
  }

  function getTotalHeight(): number {
    let total = 0;
    for (let i = 0; i < props.items.length; i++) {
      total += getItemHeight(i);
    }
    return total;
  }

  function getVisibleRange(): { start: number; end: number } {
    const top = scrollTop();
    const height = containerHeight();
    const overscan = props.overscan ?? 5;
    const items = props.items;

    let start = 0;
    let accumulated = 0;
    while (start < items.length && accumulated + getItemHeight(start) < top) {
      accumulated += getItemHeight(start);
      start++;
    }

    let end = start;
    let visibleHeight = 0;
    while (end < items.length && visibleHeight < height) {
      visibleHeight += getItemHeight(end);
      end++;
    }

    start = Math.max(0, start - overscan);
    end = Math.min(items.length, end + overscan);

    return { start, end };
  }

  function measureItem(index: number, el: HTMLDivElement) {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0 && measuredHeights.get(index) !== h) {
          measuredHeights.set(index, h);
          setScrollTop((v) => v); // trigger re-render
        }
      }
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  }

  function handleScroll() {
    if (!containerRef) return;
    const st = containerRef.scrollTop;
    setScrollTop(st);

    const distFromBottom =
      containerRef.scrollHeight - st - containerRef.clientHeight;
    setUserScrolled(distFromBottom > 50);

    if (distFromBottom < 100) {
      props.onScrollNearBottom?.();
    }
  }

  createEffect(() => {
    if (!containerRef) return;
    const ro = new ResizeObserver(() => {
      setContainerHeight(containerRef!.clientHeight);
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  // Auto-scroll to bottom on new messages
  createEffect(() => {
    const count = props.items.length;
    if (count > prevItemCount && !userScrolled()) {
      prevItemCount = count;
      requestAnimationFrame(() => {
        if (containerRef) {
          containerRef.scrollTop = containerRef.scrollHeight;
        }
      });
    } else {
      prevItemCount = count;
    }
  });

  const visibleItems = () => {
    const { start, end } = getVisibleRange();
    return props.items.slice(start, end).map((item, i) => ({
      item,
      index: start + i,
      top: getItemTop(start + i),
    }));
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        overflow: "auto",
        height: "100%",
        position: "relative",
        "will-change": "scroll-position",
      }}
    >
      <div
        style={{
          height: `${getTotalHeight()}px`,
          position: "relative",
        }}
      >
        <For each={visibleItems()}>
          {(entry) => (
            <div
              ref={(el) => measureItem(entry.index, el)}
              style={{
                position: "absolute",
                top: `${entry.top}px`,
                left: "0",
                right: "0",
              }}
            >
              {props.renderItem(entry.item, entry.index)}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
