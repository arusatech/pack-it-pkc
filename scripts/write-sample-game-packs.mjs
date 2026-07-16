#!/usr/bin/env node
/**
 * Regenerate sample Study PKC game packs under pkc/packs/.
 * Run from pack-it-pkc after build: npm run write:sample-games
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChessStudyPkc, createCustomStudyPkc } from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../../../packs");

mkdirSync(outDir, { recursive: true });

const chess = createChessStudyPkc({
  title: "Chess",
  source: "packs/chess.study.pkc",
  difficulty: 3,
  playerColor: "w",
});
writeFileSync(join(outDir, "chess.study.pkc"), chess.pkc);
console.log("wrote packs/chess.study.pkc", chess.pkc.byteLength, "bytes");

const hello = createCustomStudyPkc({
  title: "Hello Game",
  source: "packs/hello-game.study.pkc",
  kind: "hello",
  id: "hello-1",
  config: { greeting: "Hello from the cartridge" },
  css: `
:root {
  color-scheme: light dark;
  --bg: #0f1419;
  --text: #e7ecf3;
  --accent: #3d9cf0;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); }
main {
  min-height: 100%;
  display: grid;
  place-content: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
}
h1 { margin: 0; font-size: 1.6rem; font-weight: 650; }
p { margin: 0; opacity: 0.8; }
button {
  font: inherit;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 55%, #fff);
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--text);
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
`,
  html: `
<main>
  <h1 id="title">Hello Game</h1>
  <p id="msg"></p>
  <button type="button" id="close">Close</button>
</main>
`,
  js: `
(function () {
  var boot = window.__PKC_GAME__ || {};
  var cfg = boot.config || {};
  document.getElementById("title").textContent = boot.title || "Hello Game";
  document.getElementById("msg").textContent = cfg.greeting || "Ready.";
  document.getElementById("close").onclick = function () {
    parent.postMessage({ source: "pkc-game", type: "close" }, "*");
  };
  parent.postMessage({ source: "pkc-game", type: "ready", title: boot.title || "Hello Game" }, "*");
})();
`,
});
writeFileSync(join(outDir, "hello-game.study.pkc"), hello.pkc);
console.log("wrote packs/hello-game.study.pkc", hello.pkc.byteLength, "bytes");
