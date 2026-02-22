import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "path";

export default defineConfig({
  base: "/noaide/",
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
      output: {
        manualChunks: {
          codemirror: [
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/language",
            "@codemirror/merge",
            "@codemirror/lang-javascript",
            "@codemirror/lang-rust",
            "@codemirror/lang-python",
            "@codemirror/lang-json",
            "@codemirror/lang-css",
            "@codemirror/lang-html",
            "@codemirror/lang-markdown",
          ],
        },
      },
    },
  },
});
