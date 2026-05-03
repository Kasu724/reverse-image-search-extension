import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginOption } from "vite";
import { defineConfig } from "vitest/config";
import manifest from "./manifest.config";

const projectRoot = dirname(fileURLToPath(import.meta.url));

function extensionManifestPlugin(): PluginOption {
  return {
    name: "imagelab-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(manifest, null, 2)
      });
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), extensionManifestPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(projectRoot, "popup.html"),
        options: resolve(projectRoot, "options.html"),
        sidepanel: resolve(projectRoot, "sidepanel.html"),
        conversionError: resolve(projectRoot, "conversion-error.html"),
        offscreen: resolve(projectRoot, "src/offscreen/offscreen.html"),
        background: resolve(projectRoot, "src/background/serviceWorker.ts"),
        contentScript: resolve(projectRoot, "src/content/contentScript.ts")
      },
      output: {
        entryFileNames(chunk) {
          if (chunk.name === "background") {
            return "background/serviceWorker.js";
          }
          if (chunk.name === "contentScript") {
            return "content/contentScript.js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true
  }
});
