import { packStudyPkc } from "./pack-study.js";
import { createCustomStudyDocument } from "./create-custom-pkc.js";
import {
  BALL_SORT_VERSION,
  buildBallSortModule,
  type BallSortConfig,
} from "./games/ball-sort/build-ball-sort-module.js";
import type { PkcStudyDocument } from "./study-types.js";

export type CreateBallSortStudyPkcOptions = BallSortConfig & {
  title?: string | null;
  source?: string | null;
  id?: string;
  markdown?: string;
};

/**
 * Build a Study PKC containing the ball sort puzzle cartridge.
 * Ships as generic module parts (html/css/js) like any third-party game.
 */
export function createBallSortStudyDocument(
  options: CreateBallSortStudyPkcOptions = {},
): PkcStudyDocument {
  const title = options.title ?? "Ball Sort";
  const module = buildBallSortModule();

  const doc = createCustomStudyDocument({
    title,
    source: options.source,
    kind: "ball-sort",
    id: options.id ?? "ball-sort-1",
    config: {
      version: BALL_SORT_VERSION,
      level: options.level ?? 1,
      colors: options.colors ?? 4,
      tubeSize: options.tubeSize ?? 4,
      emptyTubes: options.emptyTubes ?? 2,
    },
    html: module.html,
    css: module.css,
    js: module.js,
    markdown:
      options.markdown ??
      `# ${title}\n\nSort the colored balls so every tube holds a single color. ` +
        `Tap a tube to pick it up, tap another to pour. Open **Play** to start.\n`,
  });
  return doc;
}

export function createBallSortStudyPkc(options?: CreateBallSortStudyPkcOptions): {
  document: PkcStudyDocument;
  pkc: Uint8Array;
} {
  const document = createBallSortStudyDocument(options);
  return { document, pkc: packStudyPkc(document) };
}
