/**
 * Study RAG defaults tuned for SmolLM2-135M + BGE-micro (384-d) + USearch.
 *
 * Context budget: Smol n_ctx is small (512 WASM / ~1024–2048 native). With
 * 512-token chunks, keep fuse Top_K low so the prompt fits and stays grounded.
 */

/** Target chunk size in tokens (approx. via {@link estimateTokenCount}). */
export const STUDY_CHUNK_SIZE_TOKENS = 512;

/** Sliding-window overlap between consecutive chunks (tokens). */
export const STUDY_CHUNK_OVERLAP_TOKENS = 64;

/**
 * Rough token estimate for Latin/English RAG text (~4 chars/token).
 * Good enough for windowing without shipping a full tokenizer.
 */
export const STUDY_CHARS_PER_TOKEN = 4;

/** Dense ANN candidates from USearch / exact cosine. */
export const STUDY_RAG_VECTOR_TOP_K = 8;

/** Lexical BM25 candidates before hybrid fuse. */
export const STUDY_RAG_BM25_TOP_K = 8;

/**
 * Passages injected into the Smol prompt after hybrid fuse.
 * 3 × ~512 tokens would overflow small n_ctx — we truncate each passage in the
 * prompt builder, but keep fuse small so Smol is not flooded.
 */
export const STUDY_RAG_FUSE_TOP_K = 3;

/**
 * Minimum cosine similarity for a USearch/exact hit to count as on-topic.
 * ANN always returns neighbors — below this we treat the query as not found.
 */
export const STUDY_RAG_MIN_VECTOR_SCORE = 0.45;

/**
 * Minimum fraction of significant query terms that must appear in a passage
 * (substring / light fuzzy) for lexical acceptance.
 */
export const STUDY_RAG_MIN_LEXICAL_OVERLAP = 0.34;

/** Primary generative temperature (grounded / low creativity). */
export const STUDY_RAG_TEMPERATURE = 0.1;

/** Retry temperature when the first completion is empty. */
export const STUDY_RAG_TEMPERATURE_RETRY = 0.2;

/** Max new tokens for study RAG completion. */
export const STUDY_RAG_N_PREDICT = 128;

/** USearch HNSW: neighbors per node (16 is a solid default for study-scale indexes). */
export const USEARCH_CONNECTIVITY = 16;

/** USearch: recall during indexing. */
export const USEARCH_EXPANSION_ADD = 64;

/** USearch: recall during search (balanced speed/quality for Top_K=8). */
export const USEARCH_EXPANSION_SEARCH = 48;

export function estimateTokenCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / STUDY_CHARS_PER_TOKEN));
}

export function tokensToCharBudget(tokens: number): number {
  return Math.max(1, Math.floor(tokens * STUDY_CHARS_PER_TOKEN));
}
