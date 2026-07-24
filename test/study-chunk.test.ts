import { describe, expect, it } from "vitest";
import {
  estimateTokenCount,
  packSentencesIntoChunks,
  STUDY_CHUNK_OVERLAP_TOKENS,
  STUDY_CHUNK_SIZE_TOKENS,
} from "../src/pkc/study-chunk.js";
import {
  STUDY_RAG_FUSE_TOP_K,
  STUDY_RAG_TEMPERATURE,
  STUDY_RAG_VECTOR_TOP_K,
  USEARCH_CONNECTIVITY,
} from "../src/pkc/study-rag-config.js";

describe("packSentencesIntoChunks", () => {
  it("uses 512-token windows with 64-token overlap", () => {
    expect(STUDY_CHUNK_SIZE_TOKENS).toBe(512);
    expect(STUDY_CHUNK_OVERLAP_TOKENS).toBe(64);

    // ~100 tokens each (400 chars)
    const sentences = Array.from({ length: 12 }, (_, i) =>
      `Sentence number ${i + 1} about electrochemistry and galvanic cells. `.repeat(8).trim(),
    );
    const chunks = packSentencesIntoChunks(sentences, 512, 64);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(estimateTokenCount(c)).toBeLessThanOrEqual(512 + 40); // small slack for join spaces
    }
    // Overlap: later chunk should share some wording with previous
    if (chunks.length >= 2) {
      const aWords = new Set(chunks[0]!.split(/\s+/).slice(-20));
      const bWords = chunks[1]!.split(/\s+/).slice(0, 40);
      expect(bWords.some((w) => aWords.has(w))).toBe(true);
    }
  });
});

describe("Smol RAG defaults", () => {
  it("keeps retrieval Top_K and generation conservative for small n_ctx", () => {
    expect(STUDY_RAG_VECTOR_TOP_K).toBe(8);
    expect(STUDY_RAG_FUSE_TOP_K).toBe(3);
    expect(STUDY_RAG_TEMPERATURE).toBe(0.1);
    expect(USEARCH_CONNECTIVITY).toBe(16);
  });
});
