export {}; // Ensure module scope (isolatedModules)

let wasmReady = false;
let decompressFn: ((data: Uint8Array) => Uint8Array) | null = null;
let compressFn: ((data: Uint8Array, level: number) => Uint8Array) | null = null;

async function initWasm() {
  if (wasmReady) return;
  try {
    const wasm = await import("../../wasm/compress/pkg/compress_wasm.js");
    await wasm.default();
    decompressFn = wasm.decompress;
    compressFn = wasm.compress;
    wasmReady = true;
  } catch {
    self.postMessage({ type: "error", error: "WASM Compress module not available" });
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
    if (type === "decompress" && decompressFn) {
      const input = data instanceof SharedArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data);
      const result = decompressFn(input);
      self.postMessage(
        { type: "result", id, data: result.buffer },
        { transfer: [result.buffer] },
      );
    } else if (type === "compress" && compressFn) {
      const level = e.data.level ?? 3;
      const input = new Uint8Array(data);
      const result = compressFn(input, level);
      self.postMessage(
        { type: "result", id, data: result.buffer },
        { transfer: [result.buffer] },
      );
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
