import { packStudyPkc } from "./pack-study.js";
import { createCustomStudyDocument } from "./create-custom-pkc.js";
import {
  SUDOKU_VERSION,
  buildSudokuModule,
  type SudokuConfig,
} from "./games/sudoku/build-sudoku-module.js";
import type { PkcStudyDocument } from "./study-types.js";

export type CreateSudokuStudyPkcOptions = SudokuConfig & {
  title?: string | null;
  source?: string | null;
  id?: string;
  markdown?: string;
};

/**
 * Build a Study PKC containing the Sudoku 9×9 puzzle cartridge.
 */
export function createSudokuStudyDocument(
  options: CreateSudokuStudyPkcOptions = {},
): PkcStudyDocument {
  const title = options.title ?? "Sudoku";
  const module = buildSudokuModule();

  const doc = createCustomStudyDocument({
    title,
    source: options.source,
    kind: "sudoku",
    id: options.id ?? "sudoku-1",
    config: {
      version: SUDOKU_VERSION,
      level: options.level ?? 1,
      difficulty: options.difficulty ?? "easy",
      ...(options.puzzle ? { puzzle: options.puzzle } : {}),
    },
    html: module.html,
    css: module.css,
    js: module.js,
    markdown:
      options.markdown ??
      `# ${title}\n\nFill the 9×9 grid so every row, column, and 3×3 box contains ` +
        `the digits 1–9 exactly once. Tap a cell, then use the number pad (or keys 1–9). ` +
        `Open **Play** to start.\n`,
  });
  return doc;
}

export function createSudokuStudyPkc(options?: CreateSudokuStudyPkcOptions): {
  document: PkcStudyDocument;
  pkc: Uint8Array;
} {
  const document = createSudokuStudyDocument(options);
  return { document, pkc: packStudyPkc(document) };
}
