import { gzipSync, gunzipSync } from "node:zlib";
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
  const json = Buffer.from(JSON.stringify(doc), "utf-8");
  const compressed = gzipSync(json);
  const out = new Uint8Array(PKC_MAGIC.length + 4 + compressed.length);
  out.set(PKC_MAGIC, 0);
  new DataView(out.buffer).setUint32(PKC_MAGIC.length, compressed.length, false);
  out.set(compressed, PKC_MAGIC.length + 4);
  return out;
}

export function unpackStudyPkc(data: Uint8Array): PkcStudyDocument {
  if (data.length < PKC_MAGIC.length + 4) throw new Error("Invalid PKC: too short");
  for (let i = 0; i < PKC_MAGIC.length; i++) {
    if (data[i] !== PKC_MAGIC[i]) throw new Error("Invalid PKC magic header");
  }
  const payloadLen = new DataView(data.buffer, data.byteOffset).getUint32(PKC_MAGIC.length, false);
  const payload = data.subarray(PKC_MAGIC.length + 4, PKC_MAGIC.length + 4 + payloadLen);
  const json = gunzipSync(payload);
  const doc = JSON.parse(json.toString("utf-8")) as PkcStudyDocument;
  if (doc.version !== PKC_STUDY_VERSION) {
    throw new Error(`Not a study PKC v${PKC_STUDY_VERSION} document (got version ${doc.version})`);
  }
  return doc;
}
