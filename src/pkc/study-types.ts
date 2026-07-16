/** Study PKC schema (version 2) — self-contained RAG + flash + MCQ export. */

export const PKC_STUDY_VERSION = 2 as const;

export type StudyBlockKind =
  | "text"
  | "heading"
  | "list"
  | "table"
  | "image"
  | "qa"
  | "formula"
  | "math";

export interface StudyBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StudyBlock {
  id: string;
  page: number;
  kind: StudyBlockKind;
  title?: string;
  content: string;
  bbox: StudyBBox;
  contentFormat?: "plain" | "mhchem" | "mixed" | "latex";
  question?: string;
  answer?: string;
  dataUrl?: string;
}

export interface RagChunk {
  chunkId: string;
  blockId: string;
  page: number;
  kind: StudyBlockKind;
  text: string;
  /** Dense vector; empty when embeddings were skipped. */
  embedding: number[];
}

export interface FlashCard {
  id: string;
  blockId: string;
  page: number;
  info: string;
  solution: {
    text: string;
    imageIds?: string[];
  };
}

export interface Mcq {
  id: string;
  blockId: string;
  page: number;
  question: string;
  options: [string, string, string, string];
  answerIndex: 0 | 1 | 2 | 3;
  explanation?: string;
}

/** Interactive game kinds embeddable in Study PKC (`chess`, `custom`, or any string). */
export type StudyGameKind = string;

/** AI strength 1 (easy) … 5 (hard). Host UI / chess config may override at play time. */
export type StudyGameDifficulty = 1 | 2 | 3 | 4 | 5;

/** Host bridge capabilities a cartridge may request. */
export type StudyGameBridgePermission =
  | "close"
  | "storage"
  | "tts"
  | "clipboard"
  | "share-score";

/**
 * @deprecated Prefer `StudyGameModule.documentHtml`. Kept for packs created before
 * the generic module schema.
 */
export interface StudyGamePlayer {
  mimeType: "text/html";
  html: string;
  version: number;
}

export interface StudyGameAsset {
  id: string;
  mimeType: string;
  /** Raw base64 (no data: prefix) or a full data URL. */
  data: string;
}

/**
 * Cartridge-hosted UI: separate html/css/js for authoring, or a prebuilt documentHtml.
 * Hosts assemble into one sandboxed iframe document.
 */
export interface StudyGameModule {
  /** Module contract version (bump when assemble/bridge contract changes). */
  version: number;
  /** Body markup (used when `documentHtml` is absent). */
  html?: string;
  css?: string;
  js?: string;
  /** Complete HTML document; skips stitching when present. */
  documentHtml?: string;
  assets?: StudyGameAsset[];
}

export interface StudyGameBridge {
  permissions?: StudyGameBridgePermission[];
}

/**
 * Generic interactive game / mini-app shipped inside Study PKC.
 * Third parties author `module` + `config`; hosts mount via sandboxed iframe.
 */
export interface StudyGameSpec {
  kind: StudyGameKind;
  id: string;
  title?: string;
  /** Free-form config exposed to the cartridge as `window.__PKC_GAME__.config`. */
  config?: Record<string, unknown>;
  /** Executable UI (html/css/js or documentHtml). */
  module?: StudyGameModule;
  bridge?: StudyGameBridge;
  /**
   * @deprecated Use `module.documentHtml`. Normalized on unpack.
   */
  player?: StudyGamePlayer;
}

/** First-party chess cartridge (same module path as custom games). */
export interface ChessGameSpec extends StudyGameSpec {
  kind: "chess";
  /** @deprecated Prefer config.fen — kept for older packs / helpers. */
  fen?: string;
  /** @deprecated Prefer config.pgn */
  pgn?: string;
  /** @deprecated Prefer config.playerColor */
  playerColor?: "w" | "b";
  /** @deprecated Prefer config.difficulty */
  difficulty?: StudyGameDifficulty;
  /** @deprecated Prefer config.mode */
  mode?: "play" | "puzzle";
}

export type StudyGame = StudyGameSpec;

export interface PkcStudyStats {
  blockCount: number;
  chunkCount: number;
  embeddedChunkCount: number;
  flashCardCount: number;
  mcqCount: number;
  gameCount: number;
}

export interface PkcStudyDocument {
  version: typeof PKC_STUDY_VERSION;
  title?: string | null;
  source?: string | null;
  createdAt: string;
  markdown: string;
  blocks: StudyBlock[];
  chunks: RagChunk[];
  flashCards: FlashCard[];
  mcqs: Mcq[];
  /** Interactive games (chess, …). Empty when none. */
  games: StudyGame[];
  models: {
    embedding?: string | null;
    chat?: string | null;
  };
  stats: PkcStudyStats;
  warnings?: string[];
}
