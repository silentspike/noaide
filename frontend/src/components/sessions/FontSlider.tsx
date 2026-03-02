import { createSignal, onMount } from "solid-js";

interface FontOption {
  name: string;
  mono: string;
  faces?: FontFaceDef[];
}

interface FontFaceDef {
  family: string;
  src: string;
  weight: string;
}

const FONTS: FontOption[] = [
  { name: "Monaspace", mono: "'Monaspace Neon', monospace" },
  {
    name: "JetBrains",
    mono: "'JetBrains Mono', monospace",
    faces: [
      { family: "JetBrains Mono", src: "/fonts/JetBrainsMono-Regular.woff2", weight: "400" },
      { family: "JetBrains Mono", src: "/fonts/JetBrainsMono-Medium.woff2", weight: "500" },
      { family: "JetBrains Mono", src: "/fonts/JetBrainsMono-Bold.woff2", weight: "700" },
    ],
  },
  {
    name: "Fira Code",
    mono: "'Fira Code', monospace",
    faces: [
      { family: "Fira Code", src: "/fonts/FiraCode-VF.woff2", weight: "300 700" },
    ],
  },
  {
    name: "Cascadia",
    mono: "'Cascadia Code', monospace",
    faces: [
      { family: "Cascadia Code", src: "/fonts/CascadiaCode.woff2", weight: "200 700" },
    ],
  },
  {
    name: "Geist",
    mono: "'Geist Mono', monospace",
    faces: [
      { family: "Geist Mono", src: "/fonts/GeistMono-Regular.woff2", weight: "400" },
      { family: "Geist Mono", src: "/fonts/GeistMono-Medium.woff2", weight: "500" },
      { family: "Geist Mono", src: "/fonts/GeistMono-Bold.woff2", weight: "700" },
    ],
  },
];

const STORAGE_KEY = "noaide-font-index";
const loadedFamilies = new Set<string>();

function loadFontIndex(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const idx = parseInt(stored, 10);
      if (idx >= 0 && idx < FONTS.length) return idx;
    }
  } catch { /* ignore */ }
  return 0;
}

/** Dynamically inject @font-face declarations only when the font is first used */
function ensureFontFaces(font: FontOption) {
  if (!font.faces || loadedFamilies.has(font.name)) return;
  loadedFamilies.add(font.name);

  const css = font.faces
    .map(
      (f) =>
        `@font-face { font-family: "${f.family}"; src: url("${f.src}") format("woff2"); font-weight: ${f.weight}; font-display: swap; }`,
    )
    .join("\n");

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

function applyFont(index: number) {
  const font = FONTS[index];
  if (!font) return;
  ensureFontFaces(font);
  const root = document.documentElement;
  root.style.setProperty("--font-mono", font.mono);
  root.style.setProperty("--font-sans", font.mono);
}

let transitionTimer: ReturnType<typeof setTimeout> | undefined;

function animateTransition(newIndex: number) {
  const root = document.documentElement;
  root.classList.add("theme-transitioning");
  applyFont(newIndex);
  clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => root.classList.remove("theme-transitioning"), 550);
}

export default function FontSlider() {
  const [index, setIndex] = createSignal(loadFontIndex());

  onMount(() => {
    applyFont(index());
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
        max={String(FONTS.length - 1)}
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
          "min-width": "56px",
          "text-align": "right",
          "text-transform": "uppercase",
        }}
      >
        {FONTS[index()]?.name ?? ""}
      </span>
    </div>
  );
}
