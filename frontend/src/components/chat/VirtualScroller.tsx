import {
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  For,
  type JSX,
} from "solid-js";

interface VirtualScrollerProps<T> {
  items: T[];
  estimateHeight: number;
  overscan?: number;
  /** Stable identity key — prevents re-rendering when items array reference changes
   *  but the item at a given index hasn't actually changed (same key). */
  getKey?: (item: T) => string;
  renderItem: (item: T, index: number) => JSX.Element;
  onScrollNearBottom?: () => void;
}

export default function VirtualScroller<T>(props: VirtualScrollerProps<T>) {
  let containerRef: HTMLDivElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);
  // Bumped whenever measured heights change — forces layout recalc.
  const [heightVersion, setHeightVersion] = createSignal(0);

  const measuredHeights = new Map<number, number>();

  function getItemHeight(index: number): number {
    return measuredHeights.get(index) ?? props.estimateHeight;
  }

  // ── Running total height (O(1) updates) ───────────────────────────
  // Maintained incrementally: delta when a height changes, estimate for new items.
  // Eliminates the O(n) prefix-sum recalculation that was the #1 bottleneck
  // with 135k+ items.
  let runningTotal = 0;
  let trackedItemCount = 0;

  function getTotalHeight(): number {
    heightVersion(); // track changes
    const len = props.items.length;
    if (len !== trackedItemCount) {
      if (len > trackedItemCount) {
        runningTotal += (len - trackedItemCount) * props.estimateHeight;
      } else {
        // Session switch / items removed — full recompute
        runningTotal = len * props.estimateHeight;
        measuredHeights.forEach((h, i) => {
          if (i < len) runningTotal += (h - props.estimateHeight);
        });
      }
      trackedItemCount = len;
    }
    return runningTotal;
  }

  // ── Item position: estimate-based with measured corrections ────────
  // Cost: O(measuredCount) per call — typically ~50-200, NOT O(totalItems).
  // For 135k items with ~100 measured, this is ~1000x faster than prefix sums.
  function getItemTop(index: number): number {
    heightVersion(); // track
    let top = index * props.estimateHeight;
    measuredHeights.forEach((h, i) => {
      if (i < index) top += h - props.estimateHeight;
    });
    return top;
  }

  // ── Visible range (estimate-based, no binary search over full array) ──
  const visibleRange = createMemo(
    () => {
      heightVersion();
      const top = scrollTop();
      const height = containerHeight();
      const overscan = props.overscan ?? 5;
      const len = props.items.length;
      if (len === 0) return { start: 0, end: 0 };

      // Estimate start index from scroll position
      let start = Math.min(
        Math.floor(top / props.estimateHeight),
        len - 1,
      );
      start = Math.max(0, start);

      // Compute actual top of estimated start, accounting for measured items
      let actualTop = start * props.estimateHeight;
      measuredHeights.forEach((h, i) => {
        if (i < start) actualTop += h - props.estimateHeight;
      });

      // Refine: scan up/down from estimate to find exact start
      while (start > 0 && actualTop > top) {
        start--;
        actualTop -= getItemHeight(start);
      }
      while (start < len - 1 && actualTop + getItemHeight(start) < top) {
        actualTop += getItemHeight(start);
        start++;
      }

      // Scan forward for end of visible window
      let end = start;
      let visibleH = 0;
      while (end < len && visibleH < height) {
        visibleH += getItemHeight(end);
        end++;
      }

      start = Math.max(0, start - overscan);
      end = Math.min(len, end + overscan);

      return { start, end };
    },
    undefined,
    // Skip downstream recomputation when range hasn't actually changed
    { equals: (a, b) => a.start === b.start && a.end === b.end },
  );

  // Stable array of indices — For maps by number *value*, so unchanged
  // indices keep their DOM nodes and callbacks.
  const visibleIndices = createMemo(() => {
    const { start, end } = visibleRange();
    const indices: number[] = new Array(end - start);
    for (let i = 0; i < indices.length; i++) indices[i] = start + i;
    return indices;
  });

  // ── Single ResizeObserver for ALL items ────────────────────────────
  // Critical: individual ResizeObservers cause N separate setHeightVersion
  // bumps per frame. Each bump synchronously triggers the reactive graph.
  // Single observer batches ALL height changes into ONE bump per frame.
  const itemObserver = new ResizeObserver((entries) => {
    let anyChanged = false;
    for (const entry of entries) {
      const el = entry.target as HTMLDivElement;
      const idx = parseInt(el.dataset.vsIdx || "-1", 10);
      if (idx < 0) continue;
      const h = entry.contentRect.height;
      if (h > 0 && measuredHeights.get(idx) !== h) {
        const oldH = measuredHeights.get(idx) ?? props.estimateHeight;
        measuredHeights.set(idx, h);
        // Update running total incrementally (O(1))
        runningTotal += (h - oldH);
        anyChanged = true;
      }
    }
    if (anyChanged) {
      setHeightVersion((v) => v + 1);
    }
  });
  onCleanup(() => itemObserver.disconnect());

  function measureItem(index: number, el: HTMLDivElement) {
    el.dataset.vsIdx = String(index);
    itemObserver.observe(el);
    onCleanup(() => itemObserver.unobserve(el));
  }

  // ── Pinned-to-bottom state for autoscroll ─────────────────────────
  // Tracks whether the user is at (or near) the bottom of the scroll.
  // When pinned, ANY content change (new items, height corrections) scrolls to end.
  // When user scrolls up, they unpin. Scrolling back to bottom re-pins.
  let pinnedToBottom = true;

  // ── Scroll handler ────────────────────────────────────────────────
  function handleScroll() {
    if (!containerRef) return;
    setScrollTop(containerRef.scrollTop);
    const distFromBottom =
      containerRef.scrollHeight - containerRef.scrollTop - containerRef.clientHeight;
    // Unpin when user scrolls away, re-pin when they scroll back
    pinnedToBottom = distFromBottom < 50;
    if (distFromBottom < 100) props.onScrollNearBottom?.();
  }

  // Container resize tracking
  createEffect(() => {
    if (!containerRef) return;
    const ro = new ResizeObserver(() => {
      setContainerHeight(containerRef!.clientHeight);
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  // Single unified auto-scroll effect.
  // Uses pinnedToBottom flag (updated in scroll handler) to decide whether to
  // stay pinned. No threshold guessing — if pinned, always scroll to end.
  createEffect(() => {
    props.items.length;  // new items appended
    heightVersion();     // measured heights changed
    containerHeight();   // container resized

    if (!containerRef) return;

    // Force scroll to bottom on session switch (items loaded fresh).
    if (needsScrollToEnd && props.items.length > 0) {
      containerRef.scrollTop = containerRef.scrollHeight;
      needsScrollToEnd = false;
      pinnedToBottom = true;
      return;
    }

    // Stay pinned: scroll to end on ANY content change
    if (pinnedToBottom) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  // Track the "frontier" index: items at or beyond this index are new and should animate.
  // Starts at 0 (everything animates on first load — which is fine, they stagger naturally).
  // Increases when the scroller is near bottom and new items arrive.
  let animateFrontier = 0;

  // When true, next items load will force-scroll to bottom (session switch).
  // One-shot flag: set on session switch, cleared after first scroll.
  let needsScrollToEnd = true;

  // Reset state on full item replacement (session switch)
  createEffect(() => {
    const len = props.items.length;
    if (len === 0) {
      measuredHeights.clear();
      runningTotal = 0;
      trackedItemCount = 0;
      animateFrontier = 0;
      needsScrollToEnd = true;
    }
  });

  // When new items are appended and user is pinned to bottom, animate them.
  // Otherwise (user scrolled up), skip animation to avoid distracting motion.
  createEffect(() => {
    const len = props.items.length;
    if (len <= animateFrontier) return; // no new items
    if (!pinnedToBottom) {
      // User scrolled up — skip animation for these items
      animateFrontier = len;
    }
    // else: user pinned to bottom — animateFrontier stays, new items animate
  });

  // ── Render ────────────────────────────────────────────────────────
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
        <For each={visibleIndices()}>
          {(index) => {
            // Key-based memoization: item "unchanged" if its key is the same.
            // Prevents re-rendering when items array is replaced but the
            // actual item at this index hasn't changed.
            /* eslint-disable solid/reactivity -- intentional: inside For callback, index is stable per-iteration */
            const stableItem = props.getKey
              ? createMemo(() => props.items[index], undefined, {
                  equals: (a, b) =>
                    !!a && !!b && props.getKey!(a) === props.getKey!(b),
                })
              : () => props.items[index];
            /* eslint-enable solid/reactivity */

            const shouldAnimate = index >= animateFrontier;

            return (
              <div
                ref={(el) => {
                  measureItem(index, el);
                  // After animation ends, bump frontier so re-entering items don't re-animate
                  if (shouldAnimate) {
                    el.addEventListener("animationend", () => {
                      if (index >= animateFrontier) animateFrontier = index + 1;
                    }, { once: true });
                  }
                }}
                style={{
                  position: "absolute",
                  top: `${getItemTop(index)}px`,
                  left: "0",
                  right: "0",
                  ...(shouldAnimate
                    ? {
                        animation: "chat-enter 280ms cubic-bezier(0.16, 1, 0.3, 1) both",
                      }
                    : {}),
                }}
              >
                {props.renderItem(stableItem(), index)}
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
