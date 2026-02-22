export {}; // Ensure module scope (isolatedModules)

let wasmReady = false;
let renderFn: ((markdown: string) => string) | null = null;

async function initWasm() {
  if (wasmReady) return;
  try {
    const wasm = await import("../../wasm/markdown/pkg/markdown_wasm.js");
    await wasm.default();
    renderFn = wasm.render;
    wasmReady = true;
  } catch {
    self.postMessage({ type: "error", error: "WASM Markdown renderer not available" });
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, data, id } = e.data;

  await initWasm();

  if (!wasmReady) {
    self.postMessage({ type: "error", id, error: "WASM not initialized" });
    return;
  }

  try {
    if (type === "render" && renderFn) {
      const html = renderFn(data);
      self.postMessage({ type: "result", id, data: html });
    } else if (type === "render_batch" && renderFn) {
      // Batch render multiple markdown strings
      const results = (data as string[]).map((md: string) => renderFn!(md));
      self.postMessage({ type: "result", id, data: results });
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
