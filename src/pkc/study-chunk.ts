import type { RagChunk, StudyBlock, StudyBlockKind } from "./study-types.js";

export const MIN_SENTENCE_CHARS = 24;
export const MAX_CHUNK_CHARS = 512;

function isSkippableHeading(s: string): boolean {
  const t = s.trim();
  if (t.length < MIN_SENTENCE_CHARS) return false;
  if (/^\d+(?:\.\d+)*\s+THE\s+[A-Z][A-Z0-9\s\-]{8,}\.?$/.test(t)) return true;
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 15) {
    const upper = (t.match(/[A-Z]/g) ?? []).length;
    if (
      upper / letters.length >= 0.72 &&
      t.length < 140 &&
      !/\b(is|are|was|called|include|located)\b/i.test(t)
    ) {
      return true;
    }
  }
  return false;
}

/** Split prose into study sentences. */
export function splitSentences(text: string): string[] {
  const raw = text
    .replaceAll(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE_CHARS && !isSkippableHeading(s));

  const result: string[] = [];
  for (const s of raw) {
    if (s.length <= MAX_CHUNK_CHARS) {
      result.push(s);
    } else {
      result.push(s.slice(0, MAX_CHUNK_CHARS));
    }
  }
  return result;
}

function chunkableKind(kind: StudyBlockKind): boolean {
  return kind === "text" || kind === "heading" || kind === "list" || kind === "qa" || kind === "formula" || kind === "math" || kind === "table";
}

function textsForBlock(block: StudyBlock): string[] {
  if (block.kind === "image") return [];
  if (block.kind === "qa") {
    const parts = [block.question, block.answer].filter((t) => (t ?? "").trim().length > 0) as string[];
    return parts.length ? parts : block.content ? [block.content] : [];
  }
  if (block.kind === "formula" || block.kind === "math") {
    const t = block.content.trim();
    return t ? [t] : [];
  }
  return block.content.trim() ? [block.content] : [];
}

/** Build RAG chunks from study blocks (embeddings filled later). */
export function chunkStudyBlocks(blocks: StudyBlock[]): RagChunk[] {
  const chunks: RagChunk[] = [];

  for (const block of blocks) {
    if (!chunkableKind(block.kind)) continue;
    const sources = textsForBlock(block);
    let local = 0;
    for (const source of sources) {
      const sentences =
        block.kind === "formula" || block.kind === "math"
          ? [source.slice(0, MAX_CHUNK_CHARS)]
          : splitSentences(source);
      const units = sentences.length > 0 ? sentences : source.trim().length >= 12 ? [source.trim().slice(0, MAX_CHUNK_CHARS)] : [];
      for (const text of units) {
        chunks.push({
          chunkId: `${block.id}_c${local++}`,
          blockId: block.id,
          page: block.page,
          kind: block.kind,
          text,
          embedding: [],
        });
      }
    }
  }

  return chunks;
}
