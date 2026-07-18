import { STUDY_GAME_MODULE_VERSION } from "../assemble-game.js";
import type { StudyGameModule } from "../../study-types.js";

export const SUDOKU_VERSION = 1 as const;

export type SudokuDifficulty = "easy" | "medium" | "hard";

export type SudokuConfig = {
  /** Starting level (1-based). Higher levels remove more clues. Default 1. */
  level?: number;
  /** easy ≈ 40 clues, medium ≈ 32, hard ≈ 26. Default easy. */
  difficulty?: SudokuDifficulty;
  /**
   * Optional fixed puzzle: 81 chars, digits 1–9 or `.`/`0` for empty.
   * When set, level/difficulty are ignored for generation.
   */
  puzzle?: string;
};

const SUDOKU_CSS = `
:root {
  color-scheme: light dark;
  --bg: #12141a;
  --panel: #1a1d26;
  --text: #e8eaef;
  --muted: #9aa3b5;
  --border: #2c3344;
  --accent: #5b8def;
  --given: #c8d0e0;
  --user: #7eb6ff;
  --conflict: #e5484d;
  --cell: clamp(28px, 8vw, 44px);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
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
.btn.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 22%, var(--bg)); }
.play-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px;
}
.board {
  display: grid;
  grid-template-columns: repeat(9, var(--cell));
  grid-template-rows: repeat(9, var(--cell));
  gap: 0;
  border: 2px solid var(--text);
  background: var(--border);
  user-select: none;
  touch-action: manipulation;
}
.cell {
  width: var(--cell);
  height: var(--cell);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--cell) * 0.48);
  font-weight: 650;
  background: var(--panel);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  cursor: pointer;
  color: var(--user);
}
.cell.given { color: var(--given); cursor: default; }
.cell.selected { outline: 2px solid var(--accent); outline-offset: -2px; z-index: 1; }
.cell.same { background: color-mix(in srgb, var(--accent) 18%, var(--panel)); }
.cell.peer { background: color-mix(in srgb, var(--border) 55%, var(--panel)); }
.cell.conflict { color: var(--conflict); }
.cell:nth-child(3n) { border-right-width: 2px; border-right-color: color-mix(in srgb, var(--text) 55%, var(--border)); }
.cell:nth-child(n+19):nth-child(-n+27),
.cell:nth-child(n+46):nth-child(-n+54) { border-bottom-width: 2px; border-bottom-color: color-mix(in srgb, var(--text) 55%, var(--border)); }
.pad {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  max-width: calc(var(--cell) * 9 + 16px);
}
.pad .btn { min-width: calc(var(--cell) * 0.95); padding: 8px 0; font-size: 0.95rem; font-weight: 650; }
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

const SUDOKU_HTML = `
<header class="toolbar">
  <span class="title" id="title">Sudoku</span>
  <span class="status" id="status"></span>
  <div class="actions">
    <button type="button" class="btn" id="undo">Undo</button>
    <button type="button" class="btn" id="check">Check</button>
    <button type="button" class="btn" id="restart">Restart</button>
    <button type="button" class="btn" id="next">New puzzle</button>
    <button type="button" class="btn" id="close">Close</button>
  </div>
</header>
<div class="play-area">
  <div id="board" class="board" role="grid" aria-label="Sudoku board"></div>
  <div class="pad" id="pad" role="group" aria-label="Number pad"></div>
</div>
<div id="banner" class="banner" hidden><span id="banner-text"></span></div>
`.trim();

const SUDOKU_JS = `
(function () {
  var boot = window.__PKC_GAME__ || {};
  var cfg = boot.config || {};

  var DIFFICULTY_CLUES = { easy: 40, medium: 32, hard: 26 };
  var level = Math.max(1, Number(cfg.level) || 1);
  var difficulty = (cfg.difficulty === "medium" || cfg.difficulty === "hard") ? cfg.difficulty : "easy";

  var titleEl = document.getElementById("title");
  var statusEl = document.getElementById("status");
  var boardEl = document.getElementById("board");
  var padEl = document.getElementById("pad");
  var undoBtn = document.getElementById("undo");
  var checkBtn = document.getElementById("check");
  var restartBtn = document.getElementById("restart");
  var nextBtn = document.getElementById("next");
  var closeBtn = document.getElementById("close");
  var bannerEl = document.getElementById("banner");
  var bannerText = document.getElementById("banner-text");

  titleEl.textContent = boot.title || "Sudoku";

  var given = new Array(81).fill(0);
  var grid = new Array(81).fill(0);
  var selected = -1;
  var history = [];
  var won = false;
  var showConflicts = false;

  function post(type, payload) {
    try {
      if (window.parent && window.parent !== window) {
        var msg = { source: "pkc-game", type: type };
        if (payload) for (var k in payload) msg[k] = payload[k];
        window.parent.postMessage(msg, "*");
      }
    } catch (_) {}
  }

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

  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function rowOf(i) { return (i / 9) | 0; }
  function colOf(i) { return i % 9; }
  function boxOf(i) { return ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0); }

  function isValidAt(board, idx, n) {
    var r = rowOf(idx), c = colOf(idx), b = boxOf(idx);
    for (var i = 0; i < 81; i++) {
      if (i === idx || board[i] !== n) continue;
      if (rowOf(i) === r || colOf(i) === c || boxOf(i) === b) return false;
    }
    return true;
  }

  function findEmpty(board) {
    for (var i = 0; i < 81; i++) if (!board[i]) return i;
    return -1;
  }

  function solve(board, rand, countOnly, limit) {
    var solutions = 0;
    function dfs(b) {
      if (countOnly && solutions >= (limit || 2)) return true;
      var idx = findEmpty(b);
      if (idx < 0) {
        solutions++;
        return !countOnly;
      }
      var nums = [1,2,3,4,5,6,7,8,9];
      if (rand) shuffle(nums, rand);
      for (var k = 0; k < nums.length; k++) {
        var n = nums[k];
        if (!isValidAt(b, idx, n)) continue;
        b[idx] = n;
        if (dfs(b)) {
          if (!countOnly) return true;
          if (solutions >= (limit || 2)) return true;
        }
        b[idx] = 0;
      }
      return false;
    }
    dfs(board);
    return countOnly ? solutions : solutions > 0;
  }

  function generateComplete(rand) {
    var board = new Array(81).fill(0);
    solve(board, rand, false);
    return board;
  }

  function clueTarget() {
    var base = DIFFICULTY_CLUES[difficulty] || 40;
    return Math.max(22, base - Math.floor((level - 1) / 2) * 2);
  }

  function digPuzzle(complete, rand, cluesWanted) {
    var puzzle = complete.slice();
    var order = shuffle(Array.from({ length: 81 }, function (_, i) { return i; }), rand);
    var clues = 81;
    for (var i = 0; i < order.length && clues > cluesWanted; i++) {
      var idx = order[i];
      var saved = puzzle[idx];
      if (!saved) continue;
      puzzle[idx] = 0;
      var test = puzzle.slice();
      var n = solve(test, null, true, 2);
      if (n !== 1) {
        puzzle[idx] = saved;
      } else {
        clues--;
      }
    }
    return puzzle;
  }

  function parsePuzzle(str) {
    var s = String(str || "").replace(/\\s+/g, "");
    if (s.length !== 81) return null;
    var out = new Array(81);
    for (var i = 0; i < 81; i++) {
      var ch = s.charAt(i);
      if (ch === "." || ch === "0") out[i] = 0;
      else if (ch >= "1" && ch <= "9") out[i] = Number(ch);
      else return null;
    }
    return out;
  }

  function conflictSet(board) {
    var bad = {};
    function markDupes(indices) {
      var seen = {};
      for (var i = 0; i < indices.length; i++) {
        var idx = indices[i];
        var v = board[idx];
        if (!v) continue;
        if (seen[v] != null) {
          bad[idx] = true;
          bad[seen[v]] = true;
        } else seen[v] = idx;
      }
    }
    for (var r = 0; r < 9; r++) {
      markDupes(Array.from({ length: 9 }, function (_, c) { return r * 9 + c; }));
      markDupes(Array.from({ length: 9 }, function (_, c) { return c * 9 + r; }));
    }
    for (var br = 0; br < 3; br++) for (var bc = 0; bc < 3; bc++) {
      var cells = [];
      for (var dr = 0; dr < 3; dr++) for (var dc = 0; dc < 3; dc++) {
        cells.push((br * 3 + dr) * 9 + (bc * 3 + dc));
      }
      markDupes(cells);
    }
    return bad;
  }

  function isComplete(board) {
    for (var i = 0; i < 81; i++) if (!board[i]) return false;
    return Object.keys(conflictSet(board)).length === 0;
  }

  function filledCount() {
    var n = 0;
    for (var i = 0; i < 81; i++) if (grid[i]) n++;
    return n;
  }

  function updateStatus(extra) {
    var parts = [
      "Level " + level,
      difficulty,
      filledCount() + "/81",
    ];
    if (extra) parts.push(extra);
    statusEl.textContent = parts.join(" · ");
    undoBtn.disabled = history.length === 0 || won;
  }

  function render() {
    var conflicts = showConflicts || won ? conflictSet(grid) : {};
    var selVal = selected >= 0 ? grid[selected] : 0;
    boardEl.innerHTML = "";
    for (var i = 0; i < 81; i++) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.setAttribute("role", "gridcell");
      if (given[i]) cell.className += " given";
      if (i === selected) cell.className += " selected";
      else if (selected >= 0) {
        if (rowOf(i) === rowOf(selected) || colOf(i) === colOf(selected) || boxOf(i) === boxOf(selected)) {
          cell.className += " peer";
        }
        if (selVal && grid[i] === selVal) cell.className += " same";
      }
      if (conflicts[i]) cell.className += " conflict";
      cell.textContent = grid[i] ? String(grid[i]) : "";
      (function (idx) {
        cell.addEventListener("click", function () { onCellClick(idx); });
      })(i);
      boardEl.appendChild(cell);
    }
    updateStatus(won ? "solved" : (showConflicts ? "checking" : ""));
  }

  function onCellClick(idx) {
    if (won) return;
    selected = idx;
    showConflicts = false;
    render();
  }

  function place(n) {
    if (won || selected < 0 || given[selected]) return;
    var prev = grid[selected];
    if (prev === n) return;
    history.push({ idx: selected, prev: prev, next: n });
    grid[selected] = n;
    showConflicts = false;
    render();
    if (isComplete(grid)) {
      won = true;
      bannerText.textContent = "Sudoku solved!";
      bannerEl.hidden = false;
      post("score", { level: level, difficulty: difficulty });
      render();
    }
  }

  function clearCell() {
    place(0);
  }

  function startPuzzle(lv, fixed) {
    level = Math.max(1, lv || 1);
    selected = -1;
    history = [];
    won = false;
    showConflicts = false;
    bannerEl.hidden = true;

    var parsed = fixed ? parsePuzzle(fixed) : null;
    if (parsed) {
      given = parsed.slice();
      grid = parsed.slice();
    } else {
      var seed = (level * 2654435761) ^ (difficulty.charCodeAt(0) * 97);
      var rand = rng(seed);
      var complete = generateComplete(rand);
      var puzzle = digPuzzle(complete, rand, clueTarget());
      given = puzzle.slice();
      grid = puzzle.slice();
    }
    render();
  }

  // Number pad 1–9 + clear
  for (var n = 1; n <= 9; n++) {
    (function (num) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = String(num);
      b.addEventListener("click", function () { place(num); });
      padEl.appendChild(b);
    })(n);
  }
  var clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", clearCell);
  padEl.appendChild(clearBtn);

  undoBtn.addEventListener("click", function () {
    var last = history.pop();
    if (!last) return;
    grid[last.idx] = last.prev;
    selected = last.idx;
    showConflicts = false;
    won = false;
    bannerEl.hidden = true;
    render();
  });
  checkBtn.addEventListener("click", function () {
    showConflicts = true;
    render();
  });
  restartBtn.addEventListener("click", function () {
    grid = given.slice();
    history = [];
    selected = -1;
    won = false;
    showConflicts = false;
    bannerEl.hidden = true;
    render();
  });
  nextBtn.addEventListener("click", function () {
    startPuzzle(level + 1, null);
  });
  closeBtn.addEventListener("click", function () { post("close"); });

  document.addEventListener("keydown", function (e) {
    if (won) return;
    if (e.key >= "1" && e.key <= "9") {
      place(Number(e.key));
      e.preventDefault();
    } else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
      clearCell();
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && selected >= 0) {
      selected = Math.max(0, selected - 1); render(); e.preventDefault();
    } else if (e.key === "ArrowRight" && selected >= 0) {
      selected = Math.min(80, selected + 1); render(); e.preventDefault();
    } else if (e.key === "ArrowUp" && selected >= 0) {
      selected = Math.max(0, selected - 9); render(); e.preventDefault();
    } else if (e.key === "ArrowDown" && selected >= 0) {
      selected = Math.min(80, selected + 9); render(); e.preventDefault();
    }
  });

  startPuzzle(level, cfg.puzzle || null);
  post("ready", { title: boot.title || "Sudoku" });
})();
`.trim();

/**
 * Sudoku 9×9 cartridge as generic module parts (html/css/js).
 */
export function buildSudokuModule(): StudyGameModule {
  return {
    version: STUDY_GAME_MODULE_VERSION,
    html: SUDOKU_HTML,
    css: SUDOKU_CSS,
    js: SUDOKU_JS,
  };
}
