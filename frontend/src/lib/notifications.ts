/**
 * Notification manager — Browser Notification API + In-App Toast dispatch.
 * No external dependencies, Web Audio API for optional sound cues.
 */

export interface Toast {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message?: string;
  duration?: number; // ms, default 5000
  action?: { label: string; onClick: () => void };
}

type ToastListener = (toast: Toast) => void;

let toastListeners: ToastListener[] = [];
let idCounter = 0;

/** Subscribe to toast events (used by ToastContainer). */
export function onToast(fn: ToastListener): () => void {
  toastListeners.push(fn);
  return () => {
    toastListeners = toastListeners.filter((l) => l !== fn);
  };
}

/** Dispatch a toast notification to all listeners. */
export function showToast(toast: Omit<Toast, "id">): void {
  const full: Toast = { ...toast, id: `toast-${++idCounter}` };
  for (const fn of toastListeners) fn(full);
}

/** Request browser notification permission (call once on user gesture). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Send a browser notification (only if permission granted). */
export function sendBrowserNotification(
  title: string,
  options?: { body?: string; icon?: string },
): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body: options?.body,
      icon: options?.icon ?? "/favicon.svg",
      silent: true, // we handle sound ourselves
    });
  } catch {
    // Safari/mobile may throw
  }
}

// ── Sound cues via Web Audio API ────────────────────────────────────
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/** Play a short tone for notification events. */
export function playTone(
  type: "success" | "error" | "info" | "warning",
): void {
  const ctx = getAudioCtx();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  // Different frequencies per type
  switch (type) {
    case "success":
      osc.frequency.value = 880;
      osc.type = "sine";
      break;
    case "error":
      osc.frequency.value = 220;
      osc.type = "square";
      break;
    case "info":
      osc.frequency.value = 660;
      osc.type = "sine";
      break;
    case "warning":
      osc.frequency.value = 440;
      osc.type = "triangle";
      break;
  }

  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.15);
}

// ── Notification preferences (localStorage) ────────────────────────
const PREFS_KEY = "noaide-notification-prefs";

export interface NotificationPrefs {
  browserNotifications: boolean;
  soundEnabled: boolean;
  toastsEnabled: boolean;
  events: {
    sessionComplete: boolean;
    sessionError: boolean;
    newSession: boolean;
  };
}

const defaultPrefs: NotificationPrefs = {
  browserNotifications: false,
  soundEnabled: false,
  toastsEnabled: true,
  events: {
    sessionComplete: true,
    sessionError: true,
    newSession: false,
  },
};

export function loadNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaultPrefs, ...JSON.parse(raw) } : defaultPrefs;
  } catch {
    return defaultPrefs;
  }
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
