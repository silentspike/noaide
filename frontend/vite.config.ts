import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "path";
import fs from "fs";

export default defineConfig({
  base: "/noaide/",
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 9999,
    strictPort: true,
    host: "0.0.0.0",
    https: {
      key: fs.readFileSync(resolve(__dirname, "../certs/key.pem")),
      cert: fs.readFileSync(resolve(__dirname, "../certs/cert.pem")),
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
        // Prevent Vite from crashing when backend is temporarily unavailable.
        // Without this handler, ECONNREFUSED from the proxy kills the process.
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            console.warn(`[proxy] backend unavailable: ${err.message}`);
            if (res && "writeHead" in res && !res.headersSent) {
              (res as import("http").ServerResponse).writeHead(502, {
                "Content-Type": "application/json",
              });
              (res as import("http").ServerResponse).end(
                JSON.stringify({ error: "Backend unavailable", detail: err.message }),
              );
            }
          });
        },
      },
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
