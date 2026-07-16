import { packStudyPkc } from "./pack-study.js";
import {
  STUDY_GAME_MODULE_VERSION,
  assembleGameDocument,
} from "./games/assemble-game.js";
import {
  PKC_STUDY_VERSION,
  type PkcStudyDocument,
  type StudyGameAsset,
  type StudyGameBridge,
  type StudyGameKind,
  type StudyGameSpec,
} from "./study-types.js";

export type CreateCustomStudyPkcOptions = {
  title?: string | null;
  source?: string | null;
  kind?: StudyGameKind;
  id?: string;
  markdown?: string;
  /** Free-form config → window.__PKC_GAME__.config */
  config?: Record<string, unknown>;
  html?: string;
  css?: string;
  js?: string;
  /** Prebuilt full document (skips stitching). */
  documentHtml?: string;
  assets?: StudyGameAsset[];
  bridge?: StudyGameBridge;
  /** Validate assemble succeeds at pack time. Default true. */
  validateAssemble?: boolean;
};

/**
 * Build a Study PKC with a custom HTML/CSS/JS game cartridge.
 * Authors supply module parts; the host assembles and sandboxes them at Play.
 */
export function createCustomStudyDocument(
  options: CreateCustomStudyPkcOptions = {},
): PkcStudyDocument {
  const title = options.title ?? "Custom game";
  const kind = options.kind ?? "custom";
  const id = options.id ?? "game-1";

  const hasParts =
    !!(options.documentHtml?.trim() ||
      options.html?.trim() ||
      options.css?.trim() ||
      options.js?.trim());

  if (!hasParts) {
    throw new Error("createCustomStudyPkc requires html, css, js, and/or documentHtml");
  }

  const module = {
    version: STUDY_GAME_MODULE_VERSION,
    html: options.html,
    css: options.css,
    js: options.js,
    documentHtml: options.documentHtml,
    assets: options.assets,
  };

  if (options.validateAssemble !== false) {
    // Fail early if the cartridge cannot be assembled.
    assembleGameDocument(module, {
      title,
      config: options.config,
      kind,
      id,
    });
  }

  const game: StudyGameSpec = {
    kind,
    id,
    title,
    config: options.config ?? {},
    module,
    bridge: options.bridge ?? { permissions: ["close"] },
  };

  const markdown =
    options.markdown ??
    `# ${title}\n\nInteractive game cartridge (\`${kind}\`). Open **Play** to run the embedded HTML/CSS/JS module.\n`;

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

export function createCustomStudyPkc(options?: CreateCustomStudyPkcOptions): {
  document: PkcStudyDocument;
  pkc: Uint8Array;
} {
  const document = createCustomStudyDocument(options);
  return { document, pkc: packStudyPkc(document) };
}
