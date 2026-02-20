---
id: SOLIDJS-PATTERNS
status: Stable
paths: frontend/**/*.ts, frontend/**/*.tsx
---

# SolidJS Patterns — claude-ide

## TL;DR
- SolidJS, NICHT React — kein VDOM, keine Re-Renders, fine-grained Signals
- Catppuccin Mocha Tokens aus `styles/tokens.css` verwenden
- Virtual Scroller fuer Chat (~25 DOM-Nodes bei 1000+ Messages)
- WASM Workers fuer JSONL Parsing, Markdown, Zstd (SharedArrayBuffer)
- 120Hz Target: Keine Layout Thrashing, `requestAnimationFrame` fuer Animationen

## SolidJS vs React (CRITICAL!)

### Gut (SolidJS):
```tsx
// Signals sind fine-grained reactive
const [messages, setMessages] = createSignal<Message[]>([]);
const [fps, setFps] = createSignal(0);

// Components rendern NUR EINMAL, Signals updaten DOM direkt
function MessageCard(props: { message: Message }) {
  return <div class={styles.card}>{props.message.content}</div>;
}

// createEffect trackt Dependencies automatisch
createEffect(() => {
  console.log("Messages changed:", messages().length);
});
```

### Schlecht (React-Patterns in SolidJS):
```tsx
// NICHT: useState/useEffect (das ist React!)
const [state, setState] = useState([]); // FALSCH

// NICHT: Destructuring von Props (bricht Reaktivitaet!)
function Bad({ message }) { // FALSCH — Reaktivitaet verloren!
  return <div>{message.content}</div>;
}

// NICHT: Spread auf reactive objects
const copy = { ...store }; // FALSCH — Reaktivitaet verloren!
```

## Catppuccin Mocha Tokens
```css
/* Verwende IMMER CSS Custom Properties aus tokens.css */
.component {
  background: var(--ctp-base);      /* #1e1e2e */
  color: var(--ctp-text);           /* #cdd6f4 */
  border: 1px solid var(--ctp-surface0); /* #313244 */
}
/* Status-Farben: */
/* var(--ctp-green)  = Erfolg */
/* var(--ctp-red)    = Error */
/* var(--ctp-yellow) = Warning */
/* var(--ctp-blue)   = Info/Streaming */
/* var(--ctp-mauve)  = Thinking */
/* var(--ctp-peach)  = Tool Use */
/* var(--ctp-lavender) = Idle */
```

## Virtual Scroller
- Max ~25 DOM-Nodes gleichzeitig (Pool-basiert)
- Overflow Anchor fuer Scroll-Position
- Skeleton Loading fuer nicht-gerenderte Items
- IntersectionObserver fuer Lazy Loading

## WebTransport Client
```typescript
// FlatBuffers fuer Hot Path (messages, file events)
// MessagePack fuer Cold Path (session list, config)
// Adaptive Quality: RTT-basierte Tier-Auswahl
```

## Component File Structure
```
ComponentName/
  index.tsx          # Export
  ComponentName.tsx  # Hauptkomponente
  styles.module.css  # CSS Module (Catppuccin Tokens)
```

## Icons: Phosphor Icons
```tsx
import { PhCaretRight } from "@phosphor-icons/web";
// IMMER Phosphor Icons, keine anderen Icon Libraries
```
