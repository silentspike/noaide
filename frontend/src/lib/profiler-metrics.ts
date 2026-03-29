/**
 * Global profiler metrics — lightweight counters for real-time performance monitoring.
 * Incremented by session store / transport layer, read by ProfilerPanel.
 */

// Event counter — incremented on each handleEvent call
let eventCount = 0;
let lastEventCount = 0;
let eventsPerSec = 0;
let lastEventReset = performance.now();

/** Call this on every incoming event (handleEvent, file change, etc.) */
export function incrementEventCounter(): void {
  eventCount++;
}

/** Returns events/sec (call once per second to update) */
export function getEventsPerSec(): number {
  const now = performance.now();
  const elapsed = now - lastEventReset;
  if (elapsed >= 1000) {
    eventsPerSec = Math.round(((eventCount - lastEventCount) * 1000) / elapsed);
    lastEventCount = eventCount;
    lastEventReset = now;
  }
  return eventsPerSec;
}

/** Total events received since page load */
export function getTotalEvents(): number {
  return eventCount;
}

// Render time tracking — measures time between renderItem calls
let renderSamples: number[] = [];
const MAX_SAMPLES = 60;

/** Record a render duration in ms */
export function recordRenderTime(ms: number): void {
  renderSamples.push(ms);
  if (renderSamples.length > MAX_SAMPLES) {
    renderSamples = renderSamples.slice(-MAX_SAMPLES);
  }
}

/** Average render time over last N samples (ms) */
export function getAvgRenderTime(): number {
  if (renderSamples.length === 0) return 0;
  const sum = renderSamples.reduce((a, b) => a + b, 0);
  return Math.round((sum / renderSamples.length) * 100) / 100;
}

// WebTransport connection metrics
let lastRtt = 0;
let reconnectCount = 0;

export function setTransportRtt(ms: number): void {
  lastRtt = ms;
}

export function getTransportRtt(): number {
  return lastRtt;
}

export function incrementReconnects(): void {
  reconnectCount++;
}

export function getReconnectCount(): number {
  return reconnectCount;
}

// DOM node count
export function getDomNodeCount(): number {
  return document.querySelectorAll("*").length;
}
