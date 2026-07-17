import { STUDY_GAME_MODULE_VERSION } from "../assemble-game.js";
import type { StudyGameModule } from "../../study-types.js";

export const BALL_SORT_VERSION = 1 as const;

export type BallSortConfig = {
  /** Starting level (1-based). Default 1. */
  level?: number;
  /** Colors in level 1; later levels add more. Default 4, max 8. */
  colors?: number;
  /** Balls per tube. Default 4. */
  tubeSize?: number;
  /** Empty tubes available for sorting. Default 2. */
  emptyTubes?: number;
};

const BALL_SORT_CSS = `
:root {
  color-scheme: light dark;
  --bg: #12141a;
  --panel: #1a1d26;
  --text: #e8eaef;
  --muted: #9aa3b5;
  --border: #2c3344;
  --accent: #5b8def;
  --tube-w: 52px;
  --ball: 40px;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
@media (max-width: 480px) {
  :root { --tube-w: 44px; --ball: 34px; }
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  height: 100%;
}
body { display: flex; flex-direction: column; min-height: 100%; }
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-shrink: 0;
}
.title { font-weight: 650; font-size: 0.95rem; }
.status { font-size: 0.78rem; color: var(--muted); flex: 1; min-width: 120px; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.btn {
  font: inherit;
  font-size: 0.78rem;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
}
.btn:disabled { opacity: 0.45; cursor: default; }
.btn:hover:not(:disabled) { border-color: var(--accent); }
.play-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.tubes {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: flex-end;
  gap: 14px 12px;
  max-width: 560px;
}
.tube {
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 4px;
  width: var(--tube-w);
  padding: 6px 4px 8px;
  border: 2px solid var(--border);
  border-top: none;
  border-radius: 0 0 24px 24px;
  background: color-mix(in srgb, var(--panel) 70%, transparent);
  cursor: pointer;
  transition: border-color 120ms ease, transform 120ms ease;
}
.tube.selected { border-color: var(--accent); transform: translateY(-6px); }
.tube.win-glow { border-color: #46c46e; }
.ball {
  width: var(--ball);
  height: var(--ball);
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: inset 0 6px 10px rgba(255,255,255,.35), inset 0 -6px 10px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.4);
}
.slot {
  width: var(--ball);
  height: var(--ball);
  flex-shrink: 0;
}
.banner {
  position: fixed;
  inset: auto 0 24px 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.banner span {
  background: #1f6f3d;
  color: #eafff1;
  border: 1px solid #46c46e;
  border-radius: 10px;
  padding: 10px 18px;
  font-weight: 650;
  box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
.banner[hidden] { display: none; }
`.trim();

const BALL_SORT_HTML = `
<header class="toolbar">
  <span class="title" id="title">Ball Sort</span>
  <span class="status" id="status"></span>
  <div class="actions">
    <button type="button" class="btn" id="undo">Undo</button>
    <button type="button" class="btn" id="restart">Restart</button>
    <button type="button" class="btn" id="next" hidden>Next level</button>
    <button type="button" class="btn" id="close">Close</button>
  </div>
</header>
<div class="play-area">
  <div id="tubes" class="tubes" role="group" aria-label="Ball sort tubes"></div>
</div>
<div id="banner" class="banner" hidden><span id="banner-text"></span></div>
`.trim();

const BALL_SORT_JS = `
(function () {
  var boot = window.__PKC_GAME__ || {};
  var cfg = boot.config || {};

  var COLORS = [
    "#e5484d", "#3d9cf0", "#46c46e", "#f2c14e",
    "#a06ee1", "#f07f3d", "#3dd6c8", "#e57fb3",
  ];
  var TUBE_SIZE = Math.max(2, Number(cfg.tubeSize) || 4);
  var EMPTY_TUBES = Math.max(1, Number(cfg.emptyTubes) || 2);
  var BASE_COLORS = Math.min(COLORS.length, Math.max(2, Number(cfg.colors) || 4));

  var titleEl = document.getElementById("title");
  var statusEl = document.getElementById("status");
  var tubesEl = document.getElementById("tubes");
  var undoBtn = document.getElementById("undo");
  var restartBtn = document.getElementById("restart");
  var nextBtn = document.getElementById("next");
  var closeBtn = document.getElementById("close");
  var bannerEl = document.getElementById("banner");
  var bannerText = document.getElementById("banner-text");

  var level = Math.max(1, Number(cfg.level) || 1);
  var tubes = [];
  var selected = -1;
  var moves = 0;
  var history = [];
  var won = false;

  titleEl.textContent = boot.title || "Ball Sort";

  function post(type, payload) {
    try {
      if (window.parent && window.parent !== window) {
        var msg = { source: "pkc-game", type: type };
        if (payload) for (var k in payload) msg[k] = payload[k];
        window.parent.postMessage(msg, "*");
      }
    } catch (_) {}
  }

  // Deterministic RNG so each level is reproducible (mulberry32).
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function colorsForLevel(lv) {
    return Math.min(COLORS.length, BASE_COLORS + Math.floor((lv - 1) / 2));
  }

  function isSolved(ts) {
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      if (t.length === 0) continue;
      if (t.length !== TUBE_SIZE) return false;
      for (var j = 1; j < t.length; j++) {
        if (t[j] !== t[0]) return false;
      }
    }
    return true;
  }

  function generateLevel(lv) {
    var numColors = colorsForLevel(lv);
    var rand = rng(lv * 2654435761);
    var balls = [];
    for (var c = 0; c < numColors; c++) {
      for (var n = 0; n < TUBE_SIZE; n++) balls.push(c);
    }
    var attempt = 0;
    do {
      for (var i = balls.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1));
        var tmp = balls[i]; balls[i] = balls[j]; balls[j] = tmp;
      }
      attempt++;
    } while (attempt < 20 && wouldBeSolved(balls, numColors));
    var out = [];
    for (var t = 0; t < numColors; t++) {
      out.push(balls.slice(t * TUBE_SIZE, (t + 1) * TUBE_SIZE));
    }
    for (var e = 0; e < EMPTY_TUBES; e++) out.push([]);
    return out;
  }

  function wouldBeSolved(balls, numColors) {
    var ts = [];
    for (var t = 0; t < numColors; t++) {
      ts.push(balls.slice(t * TUBE_SIZE, (t + 1) * TUBE_SIZE));
    }
    return isSolved(ts);
  }

  function topRun(tube) {
    if (tube.length === 0) return 0;
    var color = tube[tube.length - 1];
    var n = 0;
    for (var i = tube.length - 1; i >= 0 && tube[i] === color; i--) n++;
    return n;
  }

  function canPour(from, to) {
    if (from === to) return false;
    var src = tubes[from];
    var dst = tubes[to];
    if (src.length === 0) return false;
    if (dst.length >= TUBE_SIZE) return false;
    if (dst.length === 0) return true;
    return dst[dst.length - 1] === src[src.length - 1];
  }

  function pour(from, to) {
    var src = tubes[from];
    var dst = tubes[to];
    var run = topRun(src);
    var space = TUBE_SIZE - dst.length;
    var count = Math.min(run, space);
    for (var i = 0; i < count; i++) dst.push(src.pop());
    history.push({ from: from, to: to, count: count });
    moves++;
  }

  function checkWin() {
    if (!isSolved(tubes)) return;
    won = true;
    bannerText.textContent = "Level " + level + " solved in " + moves + " moves!";
    bannerEl.hidden = false;
    nextBtn.hidden = false;
    post("score", { level: level, moves: moves });
  }

  function updateStatus() {
    statusEl.textContent = "Level " + level + " · " + moves + " move" + (moves === 1 ? "" : "s");
    undoBtn.disabled = history.length === 0 || won;
  }

  function render() {
    tubesEl.innerHTML = "";
    for (var t = 0; t < tubes.length; t++) {
      var tubeEl = document.createElement("button");
      tubeEl.type = "button";
      tubeEl.className = "tube";
      if (t === selected) tubeEl.className += " selected";
      if (won) tubeEl.className += " win-glow";
      tubeEl.setAttribute("aria-label", "Tube " + (t + 1));
      for (var s = 0; s < TUBE_SIZE; s++) {
        var el = document.createElement("span");
        if (s < tubes[t].length) {
          el.className = "ball";
          el.style.background = COLORS[tubes[t][s]];
        } else {
          el.className = "slot";
        }
        tubeEl.appendChild(el);
      }
      (function (idx) {
        tubeEl.addEventListener("click", function () { onTubeClick(idx); });
      })(t);
      tubesEl.appendChild(tubeEl);
    }
    updateStatus();
  }

  function onTubeClick(idx) {
    if (won) return;
    if (selected === -1) {
      if (tubes[idx].length === 0) return;
      selected = idx;
      render();
      return;
    }
    if (selected === idx) {
      selected = -1;
      render();
      return;
    }
    if (canPour(selected, idx)) {
      pour(selected, idx);
      selected = -1;
      render();
      checkWin();
      render();
      return;
    }
    selected = tubes[idx].length > 0 ? idx : -1;
    render();
  }

  function startLevel(lv) {
    level = lv;
    tubes = generateLevel(lv);
    selected = -1;
    moves = 0;
    history = [];
    won = false;
    bannerEl.hidden = true;
    nextBtn.hidden = true;
    render();
  }

  undoBtn.addEventListener("click", function () {
    var last = history.pop();
    if (!last) return;
    for (var i = 0; i < last.count; i++) {
      tubes[last.from].push(tubes[last.to].pop());
    }
    moves++;
    selected = -1;
    render();
  });
  restartBtn.addEventListener("click", function () { startLevel(level); });
  nextBtn.addEventListener("click", function () { startLevel(level + 1); });
  closeBtn.addEventListener("click", function () { post("close"); });

  startLevel(level);
  post("ready", { title: boot.title || "Ball Sort" });
})();
`.trim();

/**
 * Ball sort cartridge as generic module parts (html/css/js) — the same shape
 * third-party games use; the host assembles it via assembleGameDocument.
 */
export function buildBallSortModule(): StudyGameModule {
  return {
    version: STUDY_GAME_MODULE_VERSION,
    html: BALL_SORT_HTML,
    css: BALL_SORT_CSS,
    js: BALL_SORT_JS,
  };
}
