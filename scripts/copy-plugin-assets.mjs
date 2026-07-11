import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const distPdf = join(dist, "pdf");
const distAssets = join(dist, "assets");
/** Repo-root static assets (fonts + katex), not under src/. */
const assetRoot = join(root, "assets");

mkdirSync(distPdf, { recursive: true });
mkdirSync(distAssets, { recursive: true });

cpSync(join(root, "src/pdf/pdf-canvas-editor.css"), join(distPdf, "pdf-canvas-editor.css"));
cpSync(join(assetRoot, "fonts"), join(distAssets, "fonts"), { recursive: true });
cpSync(join(assetRoot, "katex"), join(distAssets, "katex"), { recursive: true });

console.log("Copied plugin assets → dist/pdf + dist/assets/{fonts,katex} (from ./assets)");
