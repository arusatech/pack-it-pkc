import { normalizeStudyGames } from "./games/assemble-game.js";
import { packPkcJson, unpackPkcJson } from "./pack.js";
import { PKC_STUDY_VERSION, type PkcStudyDocument } from "./study-types.js";

/**
 * Pack a study PKC document (v2 JSON) into the same binary container as markdown PKC.
 * Magic PKC\\x01 + uint32 BE length + gzip(JSON).
 */
export function packStudyPkc(doc: PkcStudyDocument): Uint8Array {
  if (doc.version !== PKC_STUDY_VERSION) {
    throw new Error(`Unsupported study PKC version: ${doc.version}`);
  }
  return packPkcJson(doc);
}

function normalizeStudyDoc(doc: PkcStudyDocument): PkcStudyDocument {
  if (!Array.isArray(doc.games)) doc.games = [];
  else doc.games = normalizeStudyGames(doc.games);
  if (!Array.isArray(doc.flashCards)) doc.flashCards = [];
  if (!Array.isArray(doc.mcqs)) doc.mcqs = [];
  if (!doc.stats) {
    doc.stats = {
      blockCount: doc.blocks?.length ?? 0,
      chunkCount: doc.chunks?.length ?? 0,
      embeddedChunkCount: (doc.chunks ?? []).filter((c) => c.embedding?.length).length,
      flashCardCount: doc.flashCards.length,
      mcqCount: doc.mcqs.length,
      gameCount: doc.games.length,
    };
  } else if (typeof doc.stats.gameCount !== "number") {
    doc.stats.gameCount = doc.games.length;
  }
  return doc;
}

export function unpackStudyPkc(data: Uint8Array): PkcStudyDocument {
  const doc = unpackPkcJson(data) as PkcStudyDocument;
  if (doc.version !== PKC_STUDY_VERSION) {
    throw new Error(`Not a study PKC v${PKC_STUDY_VERSION} document (got version ${doc.version})`);
  }
  return normalizeStudyDoc(doc);
}
