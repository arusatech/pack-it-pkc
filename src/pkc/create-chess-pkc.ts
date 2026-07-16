import { packStudyPkc } from "./pack-study.js";
import { STUDY_GAME_MODULE_VERSION } from "./games/assemble-game.js";
import { buildChessGamePlayer } from "./games/chess/build-chess-player-html.js";
import {
  PKC_STUDY_VERSION,
  type ChessGameSpec,
  type PkcStudyDocument,
  type StudyGameDifficulty,
} from "./study-types.js";

export type CreateChessStudyPkcOptions = {
  title?: string | null;
  source?: string | null;
  fen?: string;
  pgn?: string;
  playerColor?: "w" | "b";
  difficulty?: StudyGameDifficulty;
  mode?: "play" | "puzzle";
  id?: string;
  markdown?: string;
  /** When false, omit embedded HTML module (host cannot play). Default true. */
  embedPlayer?: boolean;
};

/**
 * Build a Study PKC that contains a single chess game.
 * By default the cartridge embeds a full HTML/CSS/JS player via `module.documentHtml`.
 */
export function createChessStudyDocument(
  options: CreateChessStudyPkcOptions = {},
): PkcStudyDocument {
  const title = options.title ?? "Chess";
  const difficulty = options.difficulty ?? 3;
  const playerColor = options.playerColor ?? "w";
  const mode = options.mode ?? "play";
  const id = options.id ?? "chess-1";

  const config = {
    fen: options.fen,
    pgn: options.pgn,
    playerColor,
    difficulty,
    mode,
  };

  const game: ChessGameSpec = {
    kind: "chess",
    id,
    title,
    fen: options.fen,
    pgn: options.pgn,
    playerColor,
    difficulty,
    mode,
    config,
    bridge: { permissions: ["close"] },
  };

  if (options.embedPlayer !== false) {
    const player = buildChessGamePlayer({
      title,
      fen: options.fen,
      pgn: options.pgn,
      playerColor,
      difficulty,
      mode,
    });
    game.module = {
      version: STUDY_GAME_MODULE_VERSION,
      documentHtml: player.html,
    };
    // Legacy field for older hosts that only read `player.html`.
    game.player = player;
  }

  const markdown =
    options.markdown ??
    `# ${title}\n\nInteractive chess cartridge. Open **Play** — the board, engine, and styles ship inside this PKC.\n`;

  return {
    version: PKC_STUDY_VERSION,
    title,
    source: options.source ?? null,
    createdAt: new Date().toISOString(),
    markdown,
    blocks: [],
    chunks: [],
    flashCards: [],
    mcqs: [],
    games: [game],
    models: { embedding: null, chat: null },
    stats: {
      blockCount: 0,
      chunkCount: 0,
      embeddedChunkCount: 0,
      flashCardCount: 0,
      mcqCount: 0,
      gameCount: 1,
    },
  };
}

export function createChessStudyPkc(options?: CreateChessStudyPkcOptions): {
  document: PkcStudyDocument;
  pkc: Uint8Array;
} {
  const document = createChessStudyDocument(options);
  return { document, pkc: packStudyPkc(document) };
}
