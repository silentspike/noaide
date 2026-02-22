// Type declarations for WASM modules (generated at build time by wasm-pack)

declare module "*jsonl_parser.js" {
  export default function init(): Promise<void>;
  export function parse_line(line: string): unknown;
  export function parse_jsonl(input: string): unknown;
}

declare module "*markdown_wasm.js" {
  export default function init(): Promise<void>;
  export function render(markdown: string): string;
}

declare module "*compress_wasm.js" {
  export default function init(): Promise<void>;
  export function decompress(data: Uint8Array): Uint8Array;
  export function compress(data: Uint8Array, level: number): Uint8Array;
}
