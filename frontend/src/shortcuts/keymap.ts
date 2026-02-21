import { onMount, onCleanup } from "solid-js";

export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const wantsMod = binding.meta || binding.ctrl;

  if (wantsMod && !mod) return false;
  if (!wantsMod && mod) return false;
  if (binding.shift && !e.shiftKey) return false;
  if (!binding.shift && e.shiftKey) return false;
  if (binding.alt && !e.altKey) return false;

  return e.key.toLowerCase() === binding.key.toLowerCase();
}

export function useKeymap(getBindings: () => KeyBinding[]) {
  const handler = (e: KeyboardEvent) => {
    // Skip if user is typing in an input
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      // Allow Escape even in inputs
      if (e.key !== "Escape") return;
    }

    for (const binding of getBindings()) {
      if (matchesBinding(e, binding)) {
        e.preventDefault();
        e.stopPropagation();
        binding.action();
        return;
      }
    }
  };

  onMount(() => document.addEventListener("keydown", handler));
  onCleanup(() => document.removeEventListener("keydown", handler));
}

export const defaultBindings = {
  commandPalette: { key: "k", meta: true, description: "Open command palette" },
  toggleSidebar: { key: "/", meta: true, description: "Toggle sidebar" },
  panel1: { key: "1", meta: true, description: "Focus sessions panel" },
  panel2: { key: "2", meta: true, description: "Focus chat panel" },
  panel3: { key: "3", meta: true, description: "Focus files panel" },
  closeOverlay: { key: "Escape", description: "Close overlay" },
} as const;
