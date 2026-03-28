import { createSignal, onMount, onCleanup, For } from "solid-js";
import {
  getEventsPerSec,
  getAvgRenderTime,
  getTotalEvents,
  getTransportRtt,
  getReconnectCount,
  getDomNodeCount,
} from "../../lib/profiler-metrics";

interface ProfilerMetrics {
  fps: number;
  heapUsedMB: number;
  heapTotalMB: number;
  eventsPerSec: number;
  renderTimeMs: number;
  totalEvents: number;
  transportRtt: number;
  reconnects: number;
  domNodes: number;
}

export default function ProfilerPanel() {
  const [metrics, setMetrics] = createSignal<ProfilerMetrics>({
    fps: 0,
    heapUsedMB: 0,
    heapTotalMB: 0,
    eventsPerSec: 0,
    renderTimeMs: 0,
    totalEvents: 0,
    transportRtt: 0,
    reconnects: 0,
    domNodes: 0,
  });
  const [fpsHistory, setFpsHistory] = createSignal<number[]>([]);
  const [eventHistory, setEventHistory] = createSignal<number[]>([]);
  const [heapHistory, setHeapHistory] = createSignal<number[]>([]);

  let frameCount = 0;
  let lastFpsTime = performance.now();
  let animFrameId: number;

  const measure = () => {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
      frameCount = 0;
      lastFpsTime = now;

      const perf = performance as unknown as {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
      };
      const heapUsedMB = perf.memory
        ? Math.round(perf.memory.usedJSHeapSize / 1048576)
        : 0;
      const heapTotalMB = perf.memory
        ? Math.round(perf.memory.totalJSHeapSize / 1048576)
        : 0;

      const eps = getEventsPerSec();
      const renderMs = getAvgRenderTime();

      setMetrics({
        fps,
        heapUsedMB,
        heapTotalMB,
        eventsPerSec: eps,
        renderTimeMs: renderMs,
        totalEvents: getTotalEvents(),
        transportRtt: getTransportRtt(),
        reconnects: getReconnectCount(),
        domNodes: getDomNodeCount(),
      });

      setFpsHistory((h) => [...h.slice(-59), fps]);
      setEventHistory((h) => [...h.slice(-59), eps]);
      setHeapHistory((h) => [...h.slice(-59), heapUsedMB]);
    }
    animFrameId = requestAnimationFrame(measure);
  };

  onMount(() => {
    animFrameId = requestAnimationFrame(measure);
  });
  onCleanup(() => cancelAnimationFrame(animFrameId));

  const fpsColor = () => {
    const fps = metrics().fps;
    if (fps >= 100) return "var(--neon-green, #00ff9d)";
    if (fps >= 50) return "var(--accent-gold, #f59e0b)";
    return "var(--accent-red, #ff4444)";
  };

  const heapPercent = () => {
    const m = metrics();
    return m.heapTotalMB > 0 ? (m.heapUsedMB / m.heapTotalMB) * 100 : 0;
  };

  const heapColor = () => {
    const p = heapPercent();
    if (p < 60) return "var(--neon-blue, #00b8ff)";
    if (p < 80) return "var(--accent-gold, #f59e0b)";
    return "var(--accent-red, #ff4444)";
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
          "font-size": "13px",
          "font-weight": "700",
          "font-family": "var(--font-mono)",
          "text-transform": "uppercase",
          "letter-spacing": "0.06em",
          color: "var(--neon-purple, #a855f7)",
        }}
      >
        Performance Profiler
      </h3>

      {/* FPS Sparkline */}
      <MetricRow
        label="FPS"
        value={String(metrics().fps)}
        valueColor={fpsColor()}
        history={fpsHistory()}
        maxVal={144}
        barColorFn={(v) =>
          v >= 100 ? "var(--neon-green, #00ff9d)" : v >= 50 ? "var(--accent-gold, #f59e0b)" : "var(--accent-red, #ff4444)"
        }
      />

      {/* Heap Memory */}
      <div style={{ "margin-bottom": "16px" }}>
        <div
          style={{
            display: "flex",
            "justify-content": "space-between",
            "margin-bottom": "4px",
          }}
        >
          <span style={{ color: "var(--ctp-subtext0)", "font-family": "var(--font-mono)", "font-size": "10px", "text-transform": "uppercase", "letter-spacing": "0.06em" }}>
            JS Heap
          </span>
          <span style={{ "font-family": "var(--font-mono)", "font-size": "12px" }}>
            {metrics().heapUsedMB} / {metrics().heapTotalMB} MB
          </span>
        </div>
        <div
          style={{
            height: "6px",
            background: "var(--ctp-surface0)",
            "border-radius": "3px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${heapPercent()}%`,
              background: heapColor(),
              "border-radius": "3px",
              transition: "width 300ms ease, background 300ms ease",
            }}
          />
        </div>
        {/* Heap sparkline */}
        <Sparkline
          data={heapHistory()}
          maxVal={metrics().heapTotalMB || 100}
          color="var(--neon-blue, #00b8ff)"
          height={30}
        />
      </div>

      {/* Events/sec Sparkline */}
      <MetricRow
        label="Events/sec"
        value={String(metrics().eventsPerSec)}
        valueColor="var(--neon-blue, #00b8ff)"
        history={eventHistory()}
        maxVal={Math.max(10, ...eventHistory())}
        barColorFn={() => "var(--neon-blue, #00b8ff)"}
      />

      {/* Stats Grid */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "1fr 1fr",
          gap: "8px",
          "margin-top": "4px",
        }}
      >
        <StatCard
          label="Render Avg"
          value={`${metrics().renderTimeMs}ms`}
          color={metrics().renderTimeMs > 16 ? "var(--accent-red, #ff4444)" : "var(--neon-green, #00ff9d)"}
        />
        <StatCard
          label="Transport RTT"
          value={metrics().transportRtt > 0 ? `${metrics().transportRtt}ms` : "N/A"}
          color="var(--ctp-subtext0)"
        />
        <StatCard
          label="Total Events"
          value={formatLargeNumber(metrics().totalEvents)}
          color="var(--ctp-text)"
        />
        <StatCard
          label="Reconnects"
          value={String(metrics().reconnects)}
          color={metrics().reconnects > 0 ? "var(--accent-gold, #f59e0b)" : "var(--neon-green, #00ff9d)"}
        />
        <StatCard
          label="DOM Nodes"
          value={formatLargeNumber(metrics().domNodes)}
          color={metrics().domNodes > 3000 ? "var(--accent-gold, #f59e0b)" : "var(--ctp-text)"}
        />
        <StatCard
          label="Heap %"
          value={`${heapPercent().toFixed(0)}%`}
          color={heapColor()}
        />
      </div>
    </div>
  );
}

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Sparkline ───────────────────────────────────────────

function Sparkline(props: {
  data: number[];
  maxVal: number;
  color: string;
  height?: number;
}) {
  const h = () => props.height ?? 32;
  return (
    <div
      style={{
        height: `${h()}px`,
        display: "flex",
        "align-items": "flex-end",
        gap: "1px",
        "margin-top": "4px",
      }}
    >
      <For each={props.data}>
        {(val) => (
          <div
            style={{
              flex: "1",
              height: `${Math.min(100, (val / (props.maxVal || 1)) * 100)}%`,
              background: props.color,
              opacity: "0.6",
              "border-radius": "1px",
              "min-width": "2px",
              "min-height": "1px",
            }}
          />
        )}
      </For>
    </div>
  );
}

// ── MetricRow with sparkline ────────────────────────────

function MetricRow(props: {
  label: string;
  value: string;
  valueColor: string;
  history: number[];
  maxVal: number;
  barColorFn: (v: number) => string;
}) {
  return (
    <div style={{ "margin-bottom": "16px" }}>
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "margin-bottom": "4px",
        }}
      >
        <span
          style={{
            color: "var(--ctp-subtext0)",
            "font-family": "var(--font-mono)",
            "font-size": "10px",
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
          }}
        >
          {props.label}
        </span>
        <span
          style={{
            color: props.valueColor,
            "font-weight": "700",
            "font-size": "14px",
            "font-family": "var(--font-mono)",
          }}
        >
          {props.value}
        </span>
      </div>
      <div
        style={{
          height: "32px",
          background: "var(--ctp-surface0)",
          "border-radius": "4px",
          overflow: "hidden",
          display: "flex",
          "align-items": "flex-end",
          gap: "1px",
          padding: "2px",
        }}
      >
        <For each={props.history}>
          {(val) => (
            <div
              style={{
                flex: "1",
                height: `${Math.min(100, (val / (props.maxVal || 1)) * 100)}%`,
                background: props.barColorFn(val),
                "border-radius": "1px",
                "min-width": "2px",
                "min-height": "1px",
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}

// ── Stat Card ───────────────────────────────────────────

function StatCard(props: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        padding: "8px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--ctp-surface0)",
        "border-radius": "6px",
        "text-align": "center",
      }}
    >
      <div
        style={{
          "font-size": "9px",
          color: "var(--ctp-subtext0)",
          "margin-bottom": "2px",
          "font-family": "var(--font-mono)",
          "text-transform": "uppercase",
          "letter-spacing": "0.06em",
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          "font-size": "13px",
          "font-weight": "700",
          "font-family": "var(--font-mono)",
          color: props.color ?? "var(--ctp-text)",
        }}
      >
        {props.value}
      </div>
    </div>
  );
}
