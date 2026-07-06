import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
  },
  server: { port: 5173, open: true },
  resolve: {
    alias: {
      "node:fs/promises": resolve(root, "stubs/fs-promises.ts"),
      "node:path": resolve(root, "stubs/path.ts"),
      "node:zlib": resolve(root, "stubs/zlib.ts"),
    },
  },
  optimizeDeps: {
    exclude: ["mupdf"],
    include: ["buffer", "fflate"],
  },
});
