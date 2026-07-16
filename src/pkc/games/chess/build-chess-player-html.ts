import { CHESS_JS_CJS } from "./chess-js-embed.js";
import type { StudyGameDifficulty, StudyGamePlayer } from "../../study-types.js";

export const CHESS_PLAYER_VERSION = 1 as const;

export type ChessPlayerConfig = {
  title?: string;
  fen?: string;
  pgn?: string;
  playerColor?: "w" | "b";
  difficulty?: StudyGameDifficulty;
  mode?: "play" | "puzzle";
};

function escapeForScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const PLAYER_CSS = `
:root {
  color-scheme: light dark;
  --bg: #12141a;
  --panel: #1a1d26;
  --text: #e8eaef;
  --muted: #9aa3b5;
  --border: #2c3344;
  --accent: #5b8def;
  --sq: 52px;
  --light: #ecd6b0;
  --dark: #b58863;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
@media (max-width: 480px) {
  :root { --sq: 40px; }
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  height: 100%;
}
body {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
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
.btn, select {
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
label.diff {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  color: var(--muted);
}
.board-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.board {
  display: grid;
  grid-template-columns: repeat(8, var(--sq));
  grid-template-rows: repeat(8, var(--sq));
  width: calc(var(--sq) * 8);
  height: calc(var(--sq) * 8);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  user-select: none;
}
.sq {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--sq);
  height: var(--sq);
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.sq.light { background: var(--light); }
.sq.dark { background: var(--dark); }
.sq.selected { outline: 2px solid var(--accent); outline-offset: -2px; z-index: 1; }
.sq.last { box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--accent) 55%, transparent); }
.sq.target::after {
  content: "";
  width: 28%;
  height: 28%;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  position: absolute;
}
.sq.target.has-piece::after {
  width: 86%;
  height: 86%;
  border-radius: 0;
  background: transparent;
  box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--accent) 70%, transparent);
}
.piece {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 78%;
  height: 78%;
  border-radius: 50%;
  font-size: calc(var(--sq) * 0.52);
  line-height: 1;
  pointer-events: none;
  flex-shrink: 0;
}
.piece.white {
  background: #ffffff;
  color: #1a1a1a;
  box-shadow: 0 1px 2px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.9);
}
.piece.black {
  background: #1c1c1c;
  color: #f4f4f4;
  box-shadow: 0 1px 2px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12);
}
`.trim();

const PLAYER_APP_JS = `
(function () {
  const CFG = window.__PKC_CHESS__ || {};
  const PIECE_GLYPH = {
    wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
    bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
  };
  const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  const titleEl = document.getElementById("title");
  const statusEl = document.getElementById("status");
  const boardEl = document.getElementById("board");
  const diffSelect = document.getElementById("difficulty");
  const newBtn = document.getElementById("new");
  const undoBtn = document.getElementById("undo");
  const flipBtn = document.getElementById("flip");
  const castleKBtn = document.getElementById("castle-k");
  const castleQBtn = document.getElementById("castle-q");
  const closeBtn = document.getElementById("close");

  let chess = new Chess();
  let selected = null;
  let legalTargets = new Set();
  let flipped = false;
  let thinking = false;
  let difficulty = Number(CFG.difficulty) || 3;
  let playerColor = CFG.playerColor === "b" ? "b" : "w";
  let lastMove = null;

  titleEl.textContent = CFG.title || "Chess";
  diffSelect.value = String(Math.min(5, Math.max(1, difficulty)));

  function post(type, payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: "pkc-game", type, ...payload }, "*");
      }
    } catch (_) {}
  }

  function depthForDifficulty(d) {
    if (d <= 1) return 1;
    if (d <= 3) return 2;
    return 3;
  }

  function evaluate(c) {
    if (c.isCheckmate()) return c.turn() === "w" ? -100000 : 100000;
    if (c.isDraw() || c.isStalemate() || c.isThreefoldRepetition()) return 0;
    let score = 0;
    const board = c.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        if (!piece) continue;
        const sign = piece.color === "w" ? 1 : -1;
        score += sign * (PIECE_VALUE[piece.type] || 0);
      }
    }
    const mobility = c.moves().length;
    score += c.turn() === "w" ? mobility * 2 : -mobility * 2;
    return score;
  }

  function minimax(c, depth, alpha, beta, maximizing) {
    if (depth === 0 || c.isGameOver()) return evaluate(c);
    const moves = c.moves({ verbose: true });
    if (maximizing) {
      let best = -Infinity;
      for (const move of moves) {
        c.move(move);
        const val = minimax(c, depth - 1, alpha, beta, false);
        c.undo();
        best = Math.max(best, val);
        alpha = Math.max(alpha, val);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const move of moves) {
      c.move(move);
      const val = minimax(c, depth - 1, alpha, beta, true);
      c.undo();
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }

  function pickEngineMove() {
    const moves = chess.moves({ verbose: true });
    if (!moves.length) return null;
    if (difficulty === 1 && Math.random() < 0.45) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    const depth = depthForDifficulty(difficulty);
    const maximizing = chess.turn() === "w";
    const scored = [];
    for (const move of moves) {
      chess.move(move);
      const score = minimax(chess, depth - 1, -Infinity, Infinity, !maximizing);
      chess.undo();
      scored.push({ move, score });
    }
    scored.sort((a, b) => (maximizing ? b.score - a.score : a.score - b.score));
    const poolSize =
      difficulty <= 2 ? Math.min(4, scored.length) : difficulty === 3 ? Math.min(2, scored.length) : 1;
    return scored[Math.floor(Math.random() * poolSize)].move;
  }

  function statusLabel() {
    if (chess.isCheckmate()) {
      return chess.turn() === "w" ? "Black wins — checkmate" : "White wins — checkmate";
    }
    if (chess.isStalemate()) return "Draw — stalemate";
    if (chess.isThreefoldRepetition()) return "Draw — repetition";
    if (chess.isInsufficientMaterial()) return "Draw — insufficient material";
    if (chess.isDraw()) return "Draw";
    if (chess.isCheck()) return chess.turn() === "w" ? "White in check" : "Black in check";
    return chess.turn() === "w" ? "White to move" : "Black to move";
  }

  function updateStatus(extra) {
    const think = thinking ? " · Engine thinking…" : "";
    statusEl.textContent = extra ? extra + " · " + statusLabel() + think : statusLabel() + think;
  }

  function squaresOrdered() {
    const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = flipped
      ? ["h", "g", "f", "e", "d", "c", "b", "a"]
      : ["a", "b", "c", "d", "e", "f", "g", "h"];
    const out = [];
    for (const r of ranks) for (const f of files) out.push(f + r);
    return out;
  }

  function rookSquareForCastle(side) {
    if (playerColor === "w") return side === "k" ? "h1" : "a1";
    return side === "k" ? "h8" : "a8";
  }

  function getCastleMoves() {
    if (!humanTurn()) return { k: null, q: null };
    const moves = chess.moves({ verbose: true });
    let k = null;
    let q = null;
    for (const m of moves) {
      if (typeof m.isKingsideCastle === "function" ? m.isKingsideCastle() : m.flags.indexOf("k") >= 0) {
        k = m;
      }
      if (typeof m.isQueensideCastle === "function" ? m.isQueensideCastle() : m.flags.indexOf("q") >= 0) {
        q = m;
      }
    }
    return { k: k, q: q };
  }

  /** Castle buttons unlock when the king or that side's rook is selected. */
  function castleSelectionOk(side) {
    if (!selected) return false;
    const piece = chess.get(selected);
    if (!piece || piece.color !== playerColor) return false;
    if (piece.type === "k") return true;
    if (piece.type === "r") return selected === rookSquareForCastle(side);
    return false;
  }

  function syncCastleButtons() {
    const { k, q } = getCastleMoves();
    if (castleKBtn) {
      castleKBtn.disabled = !k || !castleSelectionOk("k");
      castleKBtn.title = k
        ? "Castle kingside (O-O)"
        : "Kingside castle not available";
    }
    if (castleQBtn) {
      castleQBtn.disabled = !q || !castleSelectionOk("q");
      castleQBtn.title = q
        ? "Castle queenside (O-O-O)"
        : "Queenside castle not available";
    }
  }

  function playCastle(side) {
    const { k, q } = getCastleMoves();
    const move = side === "k" ? k : q;
    if (!move || !castleSelectionOk(side)) return;
    try {
      chess.move(move);
      lastMove = { from: move.from, to: move.to };
      selected = null;
      legalTargets.clear();
      render();
      maybeEngineMove();
    } catch (_) {
      selected = null;
      legalTargets.clear();
      render();
    }
  }

  function render() {
    const board = chess.board();
    boardEl.innerHTML = "";
    for (const sq of squaresOrdered()) {
      const file = sq.charCodeAt(0) - 97;
      const rank = Number(sq[1]) - 1;
      const piece = board[7 - rank][file];
      const light = (file + rank) % 2 === 1;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "sq " + (light ? "light" : "dark");
      cell.dataset.square = sq;
      if (selected === sq) cell.classList.add("selected");
      if (legalTargets.has(sq)) cell.classList.add("target");
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cell.classList.add("last");
      if (piece) {
        const chip = document.createElement("span");
        chip.className = "piece " + (piece.color === "w" ? "white" : "black");
        chip.textContent = PIECE_GLYPH[piece.color + piece.type] || "";
        chip.setAttribute("aria-hidden", "true");
        cell.appendChild(chip);
        cell.classList.add("has-piece");
      }
      cell.addEventListener("click", function () { onSquareClick(sq); });
      boardEl.appendChild(cell);
    }
    undoBtn.disabled = thinking || chess.history().length === 0;
    syncCastleButtons();
    updateStatus();
  }

  function humanTurn() {
    return !chess.isGameOver() && chess.turn() === playerColor && !thinking;
  }

  function onSquareClick(sq) {
    if (!humanTurn()) return;
    if (selected) {
      if (legalTargets.has(sq)) {
        const from = selected;
        const moving = chess.get(from);
        const isPromo =
          moving &&
          moving.type === "p" &&
          ((moving.color === "w" && sq[1] === "8") || (moving.color === "b" && sq[1] === "1"));
        try {
          chess.move({ from: from, to: sq, promotion: isPromo ? "q" : undefined });
          lastMove = { from: from, to: sq };
          selected = null;
          legalTargets.clear();
          render();
          maybeEngineMove();
        } catch (_) {
          selected = null;
          legalTargets.clear();
          render();
        }
        return;
      }
      if (sq === selected) {
        selected = null;
        legalTargets.clear();
        render();
        return;
      }
    }
    const piece = chess.get(sq);
    if (!piece || piece.color !== playerColor) {
      selected = null;
      legalTargets.clear();
      render();
      return;
    }
    selected = sq;
    legalTargets = new Set(chess.moves({ square: sq, verbose: true }).map(function (m) { return m.to; }));
    render();
  }

  function maybeEngineMove() {
    if (chess.isGameOver() || chess.turn() === playerColor) {
      updateStatus();
      return;
    }
    thinking = true;
    render();
    setTimeout(function () {
      const move = pickEngineMove();
      if (move) {
        chess.move(move);
        lastMove = { from: move.from, to: move.to };
      }
      thinking = false;
      selected = null;
      legalTargets.clear();
      render();
    }, difficulty >= 4 ? 40 : 10);
  }

  function reset() {
    try {
      if (CFG.pgn) {
        chess = new Chess();
        chess.loadPgn(CFG.pgn);
      } else if (CFG.fen) {
        chess = new Chess(CFG.fen);
      } else {
        chess = new Chess();
      }
    } catch (_) {
      chess = new Chess();
    }
    playerColor = CFG.playerColor === "b" ? "b" : "w";
    flipped = playerColor === "b";
    selected = null;
    legalTargets.clear();
    lastMove = null;
    thinking = false;
    render();
    maybeEngineMove();
  }

  newBtn.addEventListener("click", reset);
  undoBtn.addEventListener("click", function () {
    if (thinking) return;
    chess.undo();
    if (chess.turn() !== playerColor && chess.history().length > 0) chess.undo();
    const hist = chess.history({ verbose: true });
    const last = hist[hist.length - 1];
    lastMove = last ? { from: last.from, to: last.to } : null;
    selected = null;
    legalTargets.clear();
    render();
  });
  flipBtn.addEventListener("click", function () {
    flipped = !flipped;
    render();
  });
  if (castleKBtn) {
    castleKBtn.addEventListener("click", function () {
      playCastle("k");
    });
  }
  if (castleQBtn) {
    castleQBtn.addEventListener("click", function () {
      playCastle("q");
    });
  }
  diffSelect.addEventListener("change", function () {
    const n = Number(diffSelect.value);
    if (n >= 1 && n <= 5) {
      difficulty = n;
      updateStatus("Difficulty " + difficulty);
    }
  });
  closeBtn.addEventListener("click", function () {
    post("close");
  });

  reset();
  post("ready", { title: CFG.title || "Chess" });
})();
`.trim();

/**
 * Build a self-contained HTML player document for a chess cartridge.
 * Includes chess.js rules engine, minimax AI, board CSS, and UI controls.
 */
export function buildChessCartridgeHtml(config: ChessPlayerConfig = {}): string {
  const boot = {
    title: config.title ?? "Chess",
    fen: config.fen,
    pgn: config.pgn,
    playerColor: config.playerColor ?? "w",
    difficulty: config.difficulty ?? 3,
    mode: config.mode ?? "play",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${boot.title.replace(/</g, "&lt;")}</title>
<style>${PLAYER_CSS}</style>
</head>
<body>
  <header class="toolbar">
    <span class="title" id="title">Chess</span>
    <span class="status" id="status">White to move</span>
    <div class="actions">
      <label class="diff">Difficulty
        <select id="difficulty" aria-label="Chess difficulty">
          <option value="1">1 · Easy</option>
          <option value="2">2</option>
          <option value="3" selected>3 · Medium</option>
          <option value="4">4</option>
          <option value="5">5 · Hard</option>
        </select>
      </label>
      <button type="button" class="btn" id="new">New game</button>
      <button type="button" class="btn" id="undo">Undo</button>
      <button type="button" class="btn" id="flip">Flip</button>
      <button type="button" class="btn" id="castle-k" disabled title="Castle kingside (O-O)">O-O</button>
      <button type="button" class="btn" id="castle-q" disabled title="Castle queenside (O-O-O)">O-O-O</button>
      <button type="button" class="btn" id="close">Close</button>
    </div>
  </header>
  <div class="board-wrap">
    <div id="board" class="board" role="grid" aria-label="Chess board"></div>
  </div>
  <script>
window.__PKC_CHESS__ = ${escapeForScriptJson(boot)};
(function(){
  // Load chess.js in an inner scope so its \`class Chess\` binding does not
  // collide with the player app's \`Chess\` constructor reference.
  var Chess = (function () {
    var module = { exports: {} };
    var exports = module.exports;
    ${CHESS_JS_CJS}
    return module.exports.Chess;
  })();
  ${PLAYER_APP_JS}
})();
  </script>
</body>
</html>`;
}

export function buildChessGamePlayer(config: ChessPlayerConfig = {}): StudyGamePlayer {
  return {
    mimeType: "text/html",
    version: CHESS_PLAYER_VERSION,
    html: buildChessCartridgeHtml(config),
  };
}
