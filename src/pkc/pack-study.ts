import { gzipSync, gunzipSync } from "fflate";
import { utf8Decode, utf8Encode } from "../utils/binary.js";
import { normalizeStudyGames } from "./games/assemble-game.js";
import { PKC_MAGIC } from "./pack.js";
import { PKC_STUDY_VERSION, type PkcStudyDocument } from "./study-types.js";

/**
 * Pack a study PKC document (v2 JSON) into the same binary container as markdown PKC.
 * Magic PKC\\x01 + uint32 BE length + gzip(JSON).
 */
export function packStudyPkc(doc: PkcStudyDocument): Uint8Array {
  if (doc.version !== PKC_STUDY_VERSION) {
    throw new Error(`Unsupported study PKC version: ${doc.version}`);
  }
  const json = utf8Encode(JSON.stringify(doc));
  const compressed = gzipSync(json);
  const out = new Uint8Array(PKC_MAGIC.length + 4 + compressed.length);
  out.set(PKC_MAGIC, 0);
  new DataView(out.buffer).setUint32(PKC_MAGIC.length, compressed.length, false);
  out.set(compressed, PKC_MAGIC.length + 4);
  return out;
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
  if (data.length < PKC_MAGIC.length + 4) throw new Error("Invalid PKC: too short");
  for (let i = 0; i < PKC_MAGIC.length; i++) {
    if (data[i] !== PKC_MAGIC[i]) throw new Error("Invalid PKC magic header");
  }
  const payloadLen = new DataView(data.buffer, data.byteOffset).getUint32(PKC_MAGIC.length, false);
  const payload = data.subarray(PKC_MAGIC.length + 4, PKC_MAGIC.length + 4 + payloadLen);
  const json = gunzipSync(payload);
  const doc = JSON.parse(utf8Decode(json)) as PkcStudyDocument;
  if (doc.version !== PKC_STUDY_VERSION) {
    throw new Error(`Not a study PKC v${PKC_STUDY_VERSION} document (got version ${doc.version})`);
  }
  return normalizeStudyDoc(doc);
}
