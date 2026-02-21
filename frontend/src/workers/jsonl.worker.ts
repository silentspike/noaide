let wasmReady = false;
let parseLine: ((line: string) => unknown) | null = null;
let parseJsonl: ((input: string) => unknown) | null = null;

async function initWasm() {
  if (wasmReady) return;
  try {
    const wasm = await import("../../wasm/jsonl-parser/pkg/jsonl_parser.js");
    await wasm.default();
    parseLine = wasm.parse_line;
    parseJsonl = wasm.parse_jsonl;
    wasmReady = true;
  } catch {
    // WASM not available — post error
    self.postMessage({ type: "error", error: "WASM JSONL parser not available" });
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
    if (type === "parse_line" && parseLine) {
      const result = parseLine(data);
      self.postMessage({ type: "result", id, data: result });
    } else if (type === "parse_jsonl" && parseJsonl) {
      const result = parseJsonl(data);
      self.postMessage({ type: "result", id, data: result });
    } else if (type === "parse_buffer") {
      // SharedArrayBuffer path
      const decoder = new TextDecoder();
      const text = decoder.decode(new Uint8Array(data));
      const result = parseJsonl!(text);
      self.postMessage({ type: "result", id, data: result });
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
