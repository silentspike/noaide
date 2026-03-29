import {
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  For,
  Show,
  type JSX,
} from "solid-js";

interface VirtualScrollerProps<T> {
  items: T[];
  estimateHeight: number;
  overscan?: number;
  getKey?: (item: T) => string;
  renderItem: (item: T, index: number) => JSX.Element;
  onScrollNearBottom?: () => void;
  onScrollNearTop?: () => void;
  /** Expose scroll-to-item function to parent */
  onScrollApi?: (api: { scrollToIndex: (index: number) => void }) => void;
}

export default function VirtualScroller<T>(props: VirtualScrollerProps<T>) {
  let containerRef: HTMLDivElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);
  const [heightVersion, setHeightVersion] = createSignal(0);

  const measuredHeights = new Map<number, number>();

  function getItemHeight(index: number): number {
    return measuredHeights.get(index) ?? props.estimateHeight;
  }

  // ── Running total height (O(1) updates) ───────────────────────────
  let runningTotal = 0;
  let trackedItemCount = 0;

  function getTotalHeight(): number {
    heightVersion();
    const len = props.items.length;
    if (len !== trackedItemCount) {
      if (len > trackedItemCount) {
        runningTotal += (len - trackedItemCount) * props.estimateHeight;
      } else {
        runningTotal = len * props.estimateHeight;
        measuredHeights.forEach((h, i) => {
          if (i < len) runningTotal += (h - props.estimateHeight);
        });
      }
      trackedItemCount = len;
    }
    return runningTotal;
  }

  // ── Prefix-sum cache for O(1) position lookups ────────────────────
  let prefixCache: Float64Array | null = null;
  let prefixCacheVersion = -1;

  function rebuildPrefixCache() {
    const ver = heightVersion();
    if (prefixCacheVersion === ver && prefixCache) return;
    prefixCacheVersion = ver;

    let maxMeasured = -1;
    measuredHeights.forEach((_, i) => { if (i > maxMeasured) maxMeasured = i; });
    if (maxMeasured < 0) { prefixCache = null; return; }

    const len = maxMeasured + 2;
    const cache = new Float64Array(len);
    cache[0] = 0;
    for (let i = 1; i < len; i++) {
      cache[i] = cache[i - 1] + (measuredHeights.get(i - 1) ?? props.estimateHeight);
    }
    prefixCache = cache;
  }

  function getItemTop(index: number): number {
    heightVersion();
    rebuildPrefixCache();

    if (prefixCache && index < prefixCache.length) {
      return prefixCache[index];
    }
    if (prefixCache && prefixCache.length > 0) {
      const cachedEnd = prefixCache.length - 1;
      return prefixCache[cachedEnd] + (index - cachedEnd) * props.estimateHeight;
    }
    return index * props.estimateHeight;
  }

  // ── Visible range ─────────────────────────────────────────────────
  const visibleRange = createMemo(
    () => {
      heightVersion();
      const top = scrollTop();
      const height = containerHeight();
      const overscan = props.overscan ?? 8;
      const len = props.items.length;
      if (len === 0) return { start: 0, end: 0 };

      rebuildPrefixCache();

      let start = Math.min(Math.floor(top / props.estimateHeight), len - 1);
      start = Math.max(0, start);

      let actualTop = getItemTop(start);
      while (start > 0 && actualTop > top) {
        start--;
        actualTop -= getItemHeight(start);
      }
      while (start < len - 1 && actualTop + getItemHeight(start) < top) {
        actualTop += getItemHeight(start);
        start++;
      }

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
    { equals: (a, b) => a.start === b.start && a.end === b.end },
  );

  const visibleIndices = createMemo(() => {
    const { start, end } = visibleRange();
    const indices: number[] = new Array(end - start);
    for (let i = 0; i < indices.length; i++) indices[i] = start + i;
    return indices;
  });

  // ── Prepend anchoring ────────────────────────────────────────────
  // When older messages are prepended, adjust scrollTop so visible
  // content stays at the same visual position (no scroll jump).
  let prevItemCount = 0;
  let prevFirstKey: string | undefined;

  createEffect(() => {
    const items = props.items;
    const len = items.length;
    const firstKey = len > 0 && props.getKey ? props.getKey(items[0]) : undefined;

    if (prevItemCount > 0 && len > prevItemCount && firstKey !== prevFirstKey && containerRef) {
      // Items were prepended (first key changed, count grew).
      // Adjust scroll by estimated height of new items.
      const prependedCount = len - prevItemCount;
      const addedHeight = prependedCount * props.estimateHeight;
      containerRef.scrollTop += addedHeight;
    }

    prevItemCount = len;
    prevFirstKey = firstKey;
  });

  // ── Scroll anchoring ─────────────────────────────────────────────
  // When items ABOVE the viewport change height, adjust scrollTop to
  // keep visible content stable. Without this, upward scrolling causes
  // visible content to jump as newly-measured items shift positions.
  let pendingAnchorDelta = 0;

  // ── Single ResizeObserver — batched via rAF ──────────────────────
  let resizePending = false;
  const itemObserver = new ResizeObserver((entries) => {
    let anyChanged = false;
    const currentScroll = containerRef?.scrollTop ?? 0;
    // First visible item index (approximate)
    const firstVisible = visibleRange().start + (props.overscan ?? 8);

    for (const entry of entries) {
      const el = entry.target as HTMLDivElement;
      const idx = parseInt(el.dataset.vsIdx || "-1", 10);
      if (idx < 0) continue;
      const h = entry.contentRect.height;
      if (h > 0 && measuredHeights.get(idx) !== h) {
        const oldH = measuredHeights.get(idx) ?? props.estimateHeight;
        const delta = h - oldH;
        measuredHeights.set(idx, h);
        runningTotal += delta;
        anyChanged = true;

        // If this item is above the viewport, anchor scroll position
        if (idx < firstVisible && currentScroll > 0) {
          pendingAnchorDelta += delta;
        }
      }
    }
    if (anyChanged && !resizePending) {
      resizePending = true;
      requestAnimationFrame(() => {
        resizePending = false;
        // Apply scroll anchor correction BEFORE reactive update
        if (pendingAnchorDelta !== 0 && containerRef) {
          containerRef.scrollTop += pendingAnchorDelta;
          pendingAnchorDelta = 0;
        }
        setHeightVersion((v) => v + 1);
      });
    }
  });
  onCleanup(() => itemObserver.disconnect());

  function measureItem(index: number, el: HTMLDivElement) {
    el.dataset.vsIdx = String(index);
    itemObserver.observe(el);
    onCleanup(() => itemObserver.unobserve(el));
  }

  // ── Pinned-to-bottom ─────────────────────────────────────────────
  const [pinnedToBottom, setPinnedToBottom] = createSignal(true);

  // ── Scroll handler — rAF throttled ──────────────────────────────
  let scrollRafId = 0;
  function handleScroll() {
    if (scrollRafId) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = 0;
      if (!containerRef) return;
      setScrollTop(containerRef.scrollTop);
      const distFromBottom =
        containerRef.scrollHeight - containerRef.scrollTop - containerRef.clientHeight;
      setPinnedToBottom(distFromBottom < 50);
      if (distFromBottom < 100) props.onScrollNearBottom?.();
      if (containerRef.scrollTop < 150) props.onScrollNearTop?.();
    });
  }
  onCleanup(() => { if (scrollRafId) cancelAnimationFrame(scrollRafId); });

  // Container resize tracking
  createEffect(() => {
    if (!containerRef) return;
    const ro = new ResizeObserver(() => {
      setContainerHeight(containerRef!.clientHeight);
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  // Auto-scroll effect
  createEffect(() => {
    props.items.length;
    heightVersion();
    containerHeight();

    if (!containerRef) return;

    if (needsScrollToEnd && props.items.length > 0) {
      containerRef.scrollTop = containerRef.scrollHeight;
      needsScrollToEnd = false;
      setPinnedToBottom(true);
      return;
    }

    if (pinnedToBottom()) {
      containerRef.scrollTo({ top: containerRef.scrollHeight, behavior: "smooth" });
    }
  });

  let animateFrontier = 0;
  let needsScrollToEnd = true;

  // Track first key to detect major list changes (grouping toggled, filter changed)
  let resetPrevLen = 0;
  let resetPrevKey: string | null = null;

  createEffect(() => {
    const len = props.items.length;
    const fk = len > 0 && props.getKey ? props.getKey(props.items[0]) : null;

    if (len === 0) {
      measuredHeights.clear();
      runningTotal = 0;
      trackedItemCount = 0;
      animateFrontier = 0;
      needsScrollToEnd = true;
      prefixCache = null;
      prefixCacheVersion = -1;
    } else if (resetPrevLen > 0 && (Math.abs(len - resetPrevLen) > resetPrevLen * 0.01 + 2 || fk !== resetPrevKey)) {
      // Major change (items added/removed beyond natural polling, or first item changed)
      // Reset measured heights since indices shifted
      measuredHeights.clear();
      runningTotal = len * props.estimateHeight;
      trackedItemCount = len;
      prefixCache = null;
      prefixCacheVersion = -1;
      setHeightVersion((v) => v + 1);
    }

    resetPrevLen = len;
    resetPrevKey = fk;
  });

  createEffect(() => {
    const len = props.items.length;
    if (len <= animateFrontier) return;
    if (!pinnedToBottom()) {
      animateFrontier = len;
    }
  });

  function scrollToBottom() {
    if (!containerRef) return;
    containerRef.scrollTo({ top: containerRef.scrollHeight, behavior: "smooth" });
    setPinnedToBottom(true);
  }

  function scrollToIndex(index: number) {
    if (!containerRef || index < 0 || index >= props.items.length) return;
    const top = getItemTop(index);
    containerRef.scrollTo({ top: Math.max(0, top - 50), behavior: "smooth" });
    setPinnedToBottom(false);
  }

  // Expose scroll API to parent
  props.onScrollApi?.({ scrollToIndex });

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
      }}
    >
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          overflow: "auto",
          height: "100%",
          position: "relative",
          "-webkit-overflow-scrolling": "touch",
          "overscroll-behavior-y": "contain",
        }}
      >
        <div
          style={{
            height: `${getTotalHeight()}px`,
            position: "relative",
            contain: "layout style",
          }}
        >
        <For each={visibleIndices()}>
          {(index) => {
            /* eslint-disable solid/reactivity */
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
                  contain: "layout style",
                  ...(shouldAnimate
                    ? { animation: "chat-enter 420ms ease-out both" }
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

      <Show when={!pinnedToBottom() && props.items.length > 0}>
        <button
          onClick={scrollToBottom}
          style={{
            position: "absolute",
            bottom: "16px",
            right: "16px",
            width: "36px",
            height: "36px",
            "border-radius": "50%",
            background: "var(--ctp-surface1)",
            border: "1px solid var(--ctp-surface2)",
            color: "var(--ctp-text)",
            cursor: "pointer",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "box-shadow": "0 2px 8px rgba(0,0,0,0.4)",
            "z-index": "10",
            transition: "all 200ms ease",
            "font-size": "16px",
            "line-height": "1",
          }}
          title="Scroll to bottom"
        >
          ↓
        </button>
      </Show>
    </div>
  );
}
