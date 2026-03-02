import { createSignal, onMount } from "solid-js";

interface Palette {
  name: string;
  colors: Record<string, string>;
}

const PALETTES: Palette[] = [
  {
    name: "Void",
    colors: {
      "--ctp-rosewater": "#f5e0dc", "--ctp-flamingo": "#f2cdcd",
      "--ctp-pink": "#f5c2e7", "--ctp-mauve": "#a855f7",
      "--ctp-red": "#ff4444", "--ctp-maroon": "#eba0ac",
      "--ctp-peach": "#fab387", "--ctp-yellow": "#f59e0b",
      "--ctp-green": "#00ff9d", "--ctp-teal": "#06b6d4",
      "--ctp-sky": "#06b6d4", "--ctp-sapphire": "#00b8ff",
      "--ctp-blue": "#00b8ff", "--ctp-lavender": "#a855f7",
      "--ctp-text": "#c8c8d0", "--ctp-subtext1": "#b0b0bc",
      "--ctp-subtext0": "#8888a0", "--ctp-overlay2": "#80808f",
      "--ctp-overlay1": "#68687a", "--ctp-overlay0": "#555568",
      "--ctp-surface2": "#353548", "--ctp-surface1": "#252535",
      "--ctp-surface0": "#1e1e2e",
      "--ctp-base": "#050508", "--ctp-mantle": "#0a0a12",
      "--ctp-crust": "#020204",
      "--bg-primary": "#050508", "--bg-secondary": "#0a0a12",
      "--bg-tertiary": "#020204", "--bg-surface": "#050508",
      "--bg-card": "#12121e", "--bg-hover": "#1a1a2a",
      "--text-primary": "#c8c8d0", "--text-secondary": "#8888a0",
      "--text-muted": "#555568", "--border": "#1e1e30",
      "--accent": "#00ff9d", "--accent-dim": "#1a3028",
      "--blue": "#00b8ff", "--green": "#00ff9d", "--red": "#ff4444",
      "--yellow": "#f59e0b", "--peach": "#fab387", "--mauve": "#a855f7",
      "--lavender": "#a855f7", "--teal": "#06b6d4", "--pink": "#f5c2e7",
      "--sky": "#06b6d4",
      "--neon-green": "#00ff9d", "--neon-blue": "#00b8ff",
      "--neon-purple": "#a855f7",
      "--void": "#020204", "--bright": "#f0f0f5",
      "--dim": "#68687a", "--glow": "#1a3028",
    },
  },
  {
    name: "Mocha",
    colors: {
      "--ctp-rosewater": "#f5e0dc", "--ctp-flamingo": "#f2cdcd",
      "--ctp-pink": "#f5c2e7", "--ctp-mauve": "#cba6f7",
      "--ctp-red": "#f38ba8", "--ctp-maroon": "#eba0ac",
      "--ctp-peach": "#fab387", "--ctp-yellow": "#f9e2af",
      "--ctp-green": "#a6e3a1", "--ctp-teal": "#94e2d5",
      "--ctp-sky": "#89dceb", "--ctp-sapphire": "#74c7ec",
      "--ctp-blue": "#89b4fa", "--ctp-lavender": "#b4befe",
      "--ctp-text": "#cdd6f4", "--ctp-subtext1": "#bac2de",
      "--ctp-subtext0": "#a6adc8", "--ctp-overlay2": "#9399b2",
      "--ctp-overlay1": "#7f849c", "--ctp-overlay0": "#6c7086",
      "--ctp-surface2": "#585b70", "--ctp-surface1": "#45475a",
      "--ctp-surface0": "#313244",
      "--ctp-base": "#1e1e2e", "--ctp-mantle": "#181825",
      "--ctp-crust": "#11111b",
      "--bg-primary": "#1e1e2e", "--bg-secondary": "#181825",
      "--bg-tertiary": "#11111b", "--bg-surface": "#1e1e2e",
      "--bg-card": "#24243a", "--bg-hover": "#313244",
      "--text-primary": "#cdd6f4", "--text-secondary": "#a6adc8",
      "--text-muted": "#6c7086", "--border": "#45475a",
      "--accent": "#cba6f7", "--accent-dim": "#2a2640",
      "--blue": "#89b4fa", "--green": "#a6e3a1", "--red": "#f38ba8",
      "--yellow": "#f9e2af", "--peach": "#fab387", "--mauve": "#cba6f7",
      "--lavender": "#b4befe", "--teal": "#94e2d5", "--pink": "#f5c2e7",
      "--sky": "#89dceb",
      "--neon-green": "#a6e3a1", "--neon-blue": "#89b4fa",
      "--neon-purple": "#cba6f7",
      "--void": "#11111b", "--bright": "#cdd6f4",
      "--dim": "#7f849c", "--glow": "#36304a",
    },
  },
  {
    name: "Dracula",
    colors: {
      "--ctp-rosewater": "#ffb2cc", "--ctp-flamingo": "#ff79c6",
      "--ctp-pink": "#ff79c6", "--ctp-mauve": "#bd93f9",
      "--ctp-red": "#ff5555", "--ctp-maroon": "#ff6e6e",
      "--ctp-peach": "#ffb86c", "--ctp-yellow": "#f1fa8c",
      "--ctp-green": "#50fa7b", "--ctp-teal": "#8be9fd",
      "--ctp-sky": "#8be9fd", "--ctp-sapphire": "#8be9fd",
      "--ctp-blue": "#bd93f9", "--ctp-lavender": "#bd93f9",
      "--ctp-text": "#f8f8f2", "--ctp-subtext1": "#e0e0da",
      "--ctp-subtext0": "#bfbfb9", "--ctp-overlay2": "#a0a0a0",
      "--ctp-overlay1": "#7a7a7a", "--ctp-overlay0": "#606060",
      "--ctp-surface2": "#4a4a5e", "--ctp-surface1": "#44475a",
      "--ctp-surface0": "#383a4e",
      "--ctp-base": "#282a36", "--ctp-mantle": "#21222c",
      "--ctp-crust": "#191a21",
      "--bg-primary": "#282a36", "--bg-secondary": "#21222c",
      "--bg-tertiary": "#191a21", "--bg-surface": "#282a36",
      "--bg-card": "#2d2f3d", "--bg-hover": "#44475a",
      "--text-primary": "#f8f8f2", "--text-secondary": "#bfbfb9",
      "--text-muted": "#6272a4", "--border": "#44475a",
      "--accent": "#ff79c6", "--accent-dim": "#3a2035",
      "--blue": "#bd93f9", "--green": "#50fa7b", "--red": "#ff5555",
      "--yellow": "#f1fa8c", "--peach": "#ffb86c", "--mauve": "#bd93f9",
      "--lavender": "#bd93f9", "--teal": "#8be9fd", "--pink": "#ff79c6",
      "--sky": "#8be9fd",
      "--neon-green": "#50fa7b", "--neon-blue": "#8be9fd",
      "--neon-purple": "#bd93f9",
      "--void": "#191a21", "--bright": "#f8f8f2",
      "--dim": "#6272a4", "--glow": "#44475a",
    },
  },
  {
    name: "Nord",
    colors: {
      "--ctp-rosewater": "#d8dee9", "--ctp-flamingo": "#d08770",
      "--ctp-pink": "#b48ead", "--ctp-mauve": "#b48ead",
      "--ctp-red": "#bf616a", "--ctp-maroon": "#d08770",
      "--ctp-peach": "#d08770", "--ctp-yellow": "#ebcb8b",
      "--ctp-green": "#a3be8c", "--ctp-teal": "#8fbcbb",
      "--ctp-sky": "#88c0d0", "--ctp-sapphire": "#81a1c1",
      "--ctp-blue": "#5e81ac", "--ctp-lavender": "#b48ead",
      "--ctp-text": "#eceff4", "--ctp-subtext1": "#e5e9f0",
      "--ctp-subtext0": "#d8dee9", "--ctp-overlay2": "#a0a8b8",
      "--ctp-overlay1": "#7b8394", "--ctp-overlay0": "#616978",
      "--ctp-surface2": "#4c566a", "--ctp-surface1": "#434c5e",
      "--ctp-surface0": "#3b4252",
      "--ctp-base": "#2e3440", "--ctp-mantle": "#292e39",
      "--ctp-crust": "#242933",
      "--bg-primary": "#2e3440", "--bg-secondary": "#292e39",
      "--bg-tertiary": "#242933", "--bg-surface": "#2e3440",
      "--bg-card": "#353b48", "--bg-hover": "#434c5e",
      "--text-primary": "#eceff4", "--text-secondary": "#d8dee9",
      "--text-muted": "#616978", "--border": "#4c566a",
      "--accent": "#88c0d0", "--accent-dim": "#2e3e45",
      "--blue": "#5e81ac", "--green": "#a3be8c", "--red": "#bf616a",
      "--yellow": "#ebcb8b", "--peach": "#d08770", "--mauve": "#b48ead",
      "--lavender": "#b48ead", "--teal": "#8fbcbb", "--pink": "#b48ead",
      "--sky": "#88c0d0",
      "--neon-green": "#a3be8c", "--neon-blue": "#88c0d0",
      "--neon-purple": "#b48ead",
      "--void": "#242933", "--bright": "#eceff4",
      "--dim": "#7b8394", "--glow": "#4c566a",
    },
  },
  {
    name: "Solar",
    colors: {
      "--ctp-rosewater": "#eee8d5", "--ctp-flamingo": "#cb4b16",
      "--ctp-pink": "#d33682", "--ctp-mauve": "#6c71c4",
      "--ctp-red": "#dc322f", "--ctp-maroon": "#cb4b16",
      "--ctp-peach": "#cb4b16", "--ctp-yellow": "#b58900",
      "--ctp-green": "#859900", "--ctp-teal": "#2aa198",
      "--ctp-sky": "#268bd2", "--ctp-sapphire": "#268bd2",
      "--ctp-blue": "#268bd2", "--ctp-lavender": "#6c71c4",
      "--ctp-text": "#93a1a1", "--ctp-subtext1": "#839496",
      "--ctp-subtext0": "#778c8e", "--ctp-overlay2": "#657b83",
      "--ctp-overlay1": "#586e75", "--ctp-overlay0": "#4a5e64",
      "--ctp-surface2": "#1a3038", "--ctp-surface1": "#0d2b35",
      "--ctp-surface0": "#073642",
      "--ctp-base": "#002b36", "--ctp-mantle": "#002530",
      "--ctp-crust": "#001f29",
      "--bg-primary": "#002b36", "--bg-secondary": "#002530",
      "--bg-tertiary": "#001f29", "--bg-surface": "#002b36",
      "--bg-card": "#073642", "--bg-hover": "#0d3640",
      "--text-primary": "#93a1a1", "--text-secondary": "#778c8e",
      "--text-muted": "#4a5e64", "--border": "#0d2b35",
      "--accent": "#b58900", "--accent-dim": "#2a2800",
      "--blue": "#268bd2", "--green": "#859900", "--red": "#dc322f",
      "--yellow": "#b58900", "--peach": "#cb4b16", "--mauve": "#6c71c4",
      "--lavender": "#6c71c4", "--teal": "#2aa198", "--pink": "#d33682",
      "--sky": "#268bd2",
      "--neon-green": "#859900", "--neon-blue": "#268bd2",
      "--neon-purple": "#6c71c4",
      "--void": "#001f29", "--bright": "#fdf6e3",
      "--dim": "#586e75", "--glow": "#1a3038",
    },
  },
];

const STORAGE_KEY = "noaide-theme-index";

function loadThemeIndex(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const idx = parseInt(stored, 10);
      if (idx >= 0 && idx < PALETTES.length) return idx;
    }
  } catch { /* ignore */ }
  return 0;
}

function applyPalette(index: number) {
  const palette = PALETTES[index];
  if (!palette) return;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(palette.colors)) {
    root.style.setProperty(prop, value);
  }
}

let transitionTimer: ReturnType<typeof setTimeout> | undefined;

function animateTransition(newIndex: number) {
  const root = document.documentElement;
  root.classList.add("theme-transitioning");
  applyPalette(newIndex);
  clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => root.classList.remove("theme-transitioning"), 550);
}

export default function ThemeSlider() {
  const [index, setIndex] = createSignal(loadThemeIndex());

  onMount(() => {
    applyPalette(index());
  });

  function onChange(newIndex: number) {
    if (newIndex === index()) return;
    setIndex(newIndex);
    localStorage.setItem(STORAGE_KEY, String(newIndex));
    animateTransition(newIndex);
  }

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        padding: "0 16px 8px",
      }}
    >
      <input
        type="range"
        min="0"
        max={String(PALETTES.length - 1)}
        step="1"
        value={index()}
        onInput={(e) => onChange(parseInt(e.currentTarget.value, 10))}
        style={{
          flex: "1",
          height: "4px",
          appearance: "none",
          "-webkit-appearance": "none",
          background: "var(--ctp-surface1)",
          "border-radius": "2px",
          outline: "none",
          cursor: "pointer",
        }}
      />
      <span
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "9px",
          "font-weight": "600",
          color: "var(--accent)",
          "letter-spacing": "0.05em",
          "min-width": "44px",
          "text-align": "right",
          "text-transform": "uppercase",
        }}
      >
        {PALETTES[index()]?.name ?? ""}
      </span>
    </div>
  );
}
