/**
 * Regenerate src/pkc/games/chess/chess-js-embed.ts from chess.js CJS.
 * Strips //# sourceMappingURL so Vite does not look for chess.js.map inside the bundle.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = dirname(require.resolve("chess.js/package.json"));
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const cjsRel =
  typeof pkg.main === "string"
    ? pkg.main
    : typeof pkg.exports?.["."]?.require === "string"
      ? pkg.exports["."].require
      : "dist/cjs/chess.js";

let source = readFileSync(join(pkgDir, cjsRel), "utf8");
source = source.replace(/\n?\/\/# sourceMappingURL=[^\n]*/g, "");

const out = join(root, "src/pkc/games/chess/chess-js-embed.ts");
const body = `/** Auto-generated — chess.js CJS inlined for cartridge players. Do not edit. */\nexport const CHESS_JS_CJS = ${JSON.stringify(source)};\n`;
writeFileSync(out, body);
console.log(`Wrote ${out} (${source.length} chars, map comments stripped)`);
