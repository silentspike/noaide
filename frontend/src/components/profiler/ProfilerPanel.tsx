import { createSignal, onMount, onCleanup, For } from "solid-js";

interface ProfilerMetrics {
  fps: number;
  heapUsedMB: number;
  heapTotalMB: number;
  eventsPerSec: number;
  renderTimeMs: number;
}

export default function ProfilerPanel() {
  const [metrics, setMetrics] = createSignal<ProfilerMetrics>({
    fps: 0,
    heapUsedMB: 0,
    heapTotalMB: 0,
    eventsPerSec: 0,
    renderTimeMs: 0,
  });
  const [history, setHistory] = createSignal<number[]>([]);

  let frameCount = 0;
  let lastFpsTime = performance.now();
  let animFrameId: number;

  const measureFps = () => {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
      frameCount = 0;
      lastFpsTime = now;

      const perf = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } });
      const heapUsedMB = perf.memory
        ? Math.round(perf.memory.usedJSHeapSize / 1048576)
        : 0;
      const heapTotalMB = perf.memory
        ? Math.round(perf.memory.totalJSHeapSize / 1048576)
        : 0;

      setMetrics((m) => ({
        ...m,
        fps,
        heapUsedMB,
        heapTotalMB,
      }));

      setHistory((h) => [...h.slice(-59), fps]);
    }
    animFrameId = requestAnimationFrame(measureFps);
  };

  onMount(() => {
    animFrameId = requestAnimationFrame(measureFps);
  });
  onCleanup(() => cancelAnimationFrame(animFrameId));

  const fpsColor = () => {
    const fps = metrics().fps;
    if (fps >= 100) return "var(--ctp-green)";
    if (fps >= 50) return "var(--ctp-yellow)";
    return "var(--ctp-red)";
  };

  return (
    <div
      style={{
        padding: "12px",
        color: "var(--ctp-text)",
        height: "100%",
        overflow: "auto",
        "font-size": "12px",
      }}
    >
      <h3
        style={{
          margin: "0 0 12px 0",
          "font-size": "14px",
          color: "var(--ctp-mauve)",
        }}
      >
        Performance Profiler
      </h3>

      {/* FPS */}
      <div style={{ "margin-bottom": "16px" }}>
        <div
          style={{
            display: "flex",
            "justify-content": "space-between",
            "margin-bottom": "4px",
          }}
        >
          <span style={{ color: "var(--ctp-subtext0)" }}>FPS</span>
          <span style={{ color: fpsColor(), "font-weight": "bold", "font-size": "16px" }}>
            {metrics().fps}
          </span>
        </div>
        <div
          style={{
            height: "40px",
            background: "var(--ctp-surface0)",
            "border-radius": "4px",
            overflow: "hidden",
            display: "flex",
            "align-items": "flex-end",
            gap: "1px",
            padding: "2px",
          }}
        >
          <For each={history()}>
            {(fps) => (
              <div
                style={{
                  flex: "1",
                  height: `${Math.min(100, (fps / 144) * 100)}%`,
                  background: fps >= 100 ? "var(--ctp-green)" : fps >= 50 ? "var(--ctp-yellow)" : "var(--ctp-red)",
                  "border-radius": "1px",
                  "min-width": "2px",
                }}
              />
            )}
          </For>
        </div>
      </div>

      {/* Memory */}
      <div style={{ "margin-bottom": "16px" }}>
        <div
          style={{
            display: "flex",
            "justify-content": "space-between",
            "margin-bottom": "4px",
          }}
        >
          <span style={{ color: "var(--ctp-subtext0)" }}>JS Heap</span>
          <span>
            {metrics().heapUsedMB} / {metrics().heapTotalMB} MB
          </span>
        </div>
        <div
          style={{
            height: "8px",
            background: "var(--ctp-surface0)",
            "border-radius": "4px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${metrics().heapTotalMB > 0 ? (metrics().heapUsedMB / metrics().heapTotalMB) * 100 : 0}%`,
              background: "var(--ctp-blue)",
              "border-radius": "4px",
              transition: "width 0.3s",
            }}
          />
        </div>
      </div>

      {/* Stats */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "1fr 1fr",
          gap: "8px",
        }}
      >
        <StatCard label="Events/sec" value={String(metrics().eventsPerSec)} />
        <StatCard label="Render" value={`${metrics().renderTimeMs}ms`} />
      </div>
    </div>
  );
}

function StatCard(props: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "8px",
        background: "var(--ctp-surface0)",
        "border-radius": "6px",
        "text-align": "center",
      }}
    >
      <div style={{ "font-size": "11px", color: "var(--ctp-subtext0)", "margin-bottom": "2px" }}>
        {props.label}
      </div>
      <div style={{ "font-size": "14px", "font-weight": "bold" }}>{props.value}</div>
    </div>
  );
}
