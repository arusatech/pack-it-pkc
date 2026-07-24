import type { RagChunk, StudyBlock, StudyBlockKind } from "./study-types.js";
import {
  DEFAULT_STUDY_PIPELINE_CONFIG,
  STUDY_CHUNK_OVERLAP_TOKENS,
  STUDY_CHUNK_SIZE_TOKENS,
  estimateTokenCount,
  tokensToCharBudget,
  type StudyPipelineConfig,
} from "./study-rag-config.js";

export const MIN_SENTENCE_CHARS = 24;

/** @deprecated Prefer STUDY_CHUNK_SIZE_TOKENS; kept as char ceiling for single sentences. */
export const MAX_CHUNK_CHARS = tokensToCharBudget(STUDY_CHUNK_SIZE_TOKENS);

export type ChunkStudyBlocksOptions = {
  chunkSizeTokens?: number;
  chunkOverlapTokens?: number;
};

export {
  STUDY_CHUNK_SIZE_TOKENS,
  STUDY_CHUNK_OVERLAP_TOKENS,
  estimateTokenCount,
} from "./study-rag-config.js";

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

  const maxChars = MAX_CHUNK_CHARS;
  const result: string[] = [];
  for (const s of raw) {
    if (s.length <= maxChars) {
      result.push(s);
    } else {
      // Oversized sentence: hard-split on char budget aligned to token size.
      for (let i = 0; i < s.length; i += maxChars) {
        const piece = s.slice(i, i + maxChars).trim();
        if (piece) result.push(piece);
      }
    }
  }
  return result;
}

/**
 * Pack sentences into ~{@link STUDY_CHUNK_SIZE_TOKENS}-token windows with
 * {@link STUDY_CHUNK_OVERLAP_TOKENS} token overlap (sentence-aligned when possible).
 */
export function packSentencesIntoChunks(
  sentences: string[],
  sizeTokens: number = STUDY_CHUNK_SIZE_TOKENS,
  overlapTokens: number = STUDY_CHUNK_OVERLAP_TOKENS,
): string[] {
  if (sentences.length === 0) return [];
  if (sizeTokens <= 0) throw new Error("sizeTokens must be > 0");
  const overlap = Math.max(0, Math.min(overlapTokens, sizeTokens - 1));

  const chunks: string[] = [];
  let start = 0;

  while (start < sentences.length) {
    let end = start;
    let tokens = 0;
    while (end < sentences.length) {
      const next = estimateTokenCount(sentences[end]!);
      if (end > start && tokens + next > sizeTokens) break;
      tokens += next;
      end += 1;
      if (tokens >= sizeTokens) break;
    }

    if (end === start) {
      // Single sentence larger than window — already sliced in splitSentences.
      end = start + 1;
    }

    const text = sentences.slice(start, end).join(" ").trim();
    if (text) chunks.push(text);

    if (end >= sentences.length) break;

    // Walk back from `end` until overlap budget is covered.
    let backTokens = 0;
    let overlapStart = end;
    while (overlapStart > start && backTokens < overlap) {
      overlapStart -= 1;
      backTokens += estimateTokenCount(sentences[overlapStart]!);
    }
    // Always advance; avoid infinite loop when overlap covers the whole window.
    start = Math.max(overlapStart, start + 1);
  }

  return chunks;
}

function chunkableKind(kind: StudyBlockKind): boolean {
  return (
    kind === "text" ||
    kind === "heading" ||
    kind === "list" ||
    kind === "qa" ||
    kind === "formula" ||
    kind === "math" ||
    kind === "table"
  );
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
export function chunkStudyBlocks(
  blocks: StudyBlock[],
  options?: ChunkStudyBlocksOptions | Partial<Pick<StudyPipelineConfig, "chunkSizeTokens" | "chunkOverlapTokens">>,
): RagChunk[] {
  const sizeTokens = options?.chunkSizeTokens ?? DEFAULT_STUDY_PIPELINE_CONFIG.chunkSizeTokens;
  const overlapTokens =
    options?.chunkOverlapTokens ?? DEFAULT_STUDY_PIPELINE_CONFIG.chunkOverlapTokens;
  const maxChars = tokensToCharBudget(sizeTokens);
  const chunks: RagChunk[] = [];

  for (const block of blocks) {
    if (!chunkableKind(block.kind)) continue;
    const sources = textsForBlock(block);
    let local = 0;
    for (const source of sources) {
      let units: string[];
      if (block.kind === "formula" || block.kind === "math") {
        units = [source.slice(0, maxChars)];
      } else {
        const sentences = splitSentences(source);
        units =
          sentences.length > 0
            ? packSentencesIntoChunks(sentences, sizeTokens, overlapTokens)
            : source.trim().length >= 12
              ? packSentencesIntoChunks(
                  [source.trim().slice(0, maxChars)],
                  sizeTokens,
                  overlapTokens,
                )
              : [];
      }
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
