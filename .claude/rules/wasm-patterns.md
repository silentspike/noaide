---
id: WASM-PATTERNS
status: Stable
paths: wasm/**/*.rs, frontend/src/workers/**/*.ts
---

# WASM Patterns — claude-ide

## TL;DR
- 3 WASM Module: jsonl-parser, markdown (pulldown-cmark), compress (zstd)
- SharedArrayBuffer fuer zero-copy Transfer (COOP/COEP Pflicht!)
- Web Workers: Jedes Modul in eigenem Worker Thread
- `wasm-pack build --target web` (nicht bundler!)

## Build
```bash
# Einzelnes Modul
wasm-pack build wasm/jsonl-parser --target web --out-dir ../../frontend/src/wasm/jsonl-parser

# Alle Module
for mod in jsonl-parser markdown compress; do
  wasm-pack build wasm/$mod --target web --out-dir ../../frontend/src/wasm/$mod
done
```

## Worker Pattern
```typescript
// Worker erstellen
const worker = new Worker(
  new URL('./workers/jsonl.worker.ts', import.meta.url),
  { type: 'module' }
);

// SharedArrayBuffer fuer zero-copy
const buffer = new SharedArrayBuffer(1024 * 1024); // 1MB
worker.postMessage({ type: 'parse', buffer }, []);
```

## COOP/COEP Headers (PFLICHT!)
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
Ohne diese Header: `SharedArrayBuffer` ist `undefined` → WASM Workers funktionieren nicht!

## Performance
- JSONL Parser: >10000 Lines/sec Ziel
- Markdown: Inkrementelles Rendering (nur geaenderte Blocks)
- Compress: Zstd Streaming Decompression
