/**
 * Study RAG defaults tuned for SmolLM2-135M + BGE-micro (384-d) + USearch.
 *
 * Host apps pass `Partial<StudyPipelineConfig>` into generate / retrieve / answer;
 * use {@link resolveStudyPipelineConfig} to merge overrides over defaults.
 *
 * Note: `embeddingDimensions` (BGE → USearch) is independent of SmolLM2
 * `chatNCtx` / `nPredict` / `temperature`.
 */

import { BGE_EMBEDDING_DIMENSION } from "../inference/model-catalog.js";

/**
 * Rough token estimate for Latin/English RAG text (~4 chars/token).
 * Good enough for windowing without shipping a full tokenizer.
 */
export const STUDY_CHARS_PER_TOKEN = 4;

/** Unified pipeline knobs (chunk → embed → USearch → Smol RAG). */
export type StudyPipelineConfig = {
  /** Target chunk size in tokens (approx. via {@link estimateTokenCount}). */
  chunkSizeTokens: number;
  /** Sliding-window overlap between consecutive chunks (tokens). */
  chunkOverlapTokens: number;
  /** Expected BGE output dim; USearch / exact-cosine must match actual vectors. */
  embeddingDimensions: number;
  /** Dense ANN candidates from USearch / exact cosine. */
  vectorTopK: number;
  /** Lexical BM25 candidates before hybrid fuse. */
  bm25TopK: number;
  /** Passages injected into the Smol prompt after hybrid fuse. */
  fuseTopK: number;
  /** Minimum cosine similarity for a hit to count as on-topic. */
  minVectorScore: number;
  /** Minimum fraction of significant query terms for lexical acceptance. */
  minLexicalOverlap: number;
  /** Primary generative temperature (grounded / low creativity). */
  temperature: number;
  /** Retry temperature when the first completion is empty. */
  temperatureRetry: number;
  /** Max new tokens for study RAG completion. */
  nPredict: number;
  /** llama.cpp context size when loading the chat GGUF. */
  chatNCtx: number;
  /** llama.cpp context size when loading the embedding GGUF. */
  embeddingNCtx: number;
  /** USearch HNSW: neighbors per node. */
  usearchConnectivity: number;
  /** USearch: recall during indexing. */
  usearchExpansionAdd: number;
  /** USearch: recall during search. */
  usearchExpansionSearch: number;
  /** Post-process clamp: max words in a study chat reply (host range 10–500). */
  maxReplyWords: number;
  /** Post-process clamp: max sentences in a study chat reply. */
  maxReplySentences: number;
};

/** Host UI / pipeline: reply word clamp lower bound. */
export const STUDY_REPLY_WORDS_MIN = 10;

/** Host UI / pipeline: reply word clamp upper bound. */
export const STUDY_REPLY_WORDS_MAX = 500;

export const DEFAULT_STUDY_PIPELINE_CONFIG: StudyPipelineConfig = {
  chunkSizeTokens: 512,
  chunkOverlapTokens: 64,
  embeddingDimensions: BGE_EMBEDDING_DIMENSION,
  vectorTopK: 8,
  bm25TopK: 8,
  fuseTopK: 3,
  minVectorScore: 0.45,
  minLexicalOverlap: 0.34,
  temperature: 0.1,
  temperatureRetry: 0.2,
  /** Enough headroom for up to ~500-word replies. */
  nPredict: 512,
  chatNCtx: 2048,
  embeddingNCtx: 512,
  usearchConnectivity: 16,
  usearchExpansionAdd: 64,
  usearchExpansionSearch: 48,
  maxReplyWords: STUDY_REPLY_WORDS_MAX,
  /** High enough that the word cap is the binding limit for text-box answers. */
  maxReplySentences: 40,
};

function clampReplyWords(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_STUDY_PIPELINE_CONFIG.maxReplyWords;
  return Math.min(STUDY_REPLY_WORDS_MAX, Math.max(STUDY_REPLY_WORDS_MIN, Math.round(n)));
}

/** Merge host overrides over {@link DEFAULT_STUDY_PIPELINE_CONFIG}. */
export function resolveStudyPipelineConfig(
  overrides?: Partial<StudyPipelineConfig> | null,
): StudyPipelineConfig {
  if (!overrides) return { ...DEFAULT_STUDY_PIPELINE_CONFIG };
  const merged = { ...DEFAULT_STUDY_PIPELINE_CONFIG, ...overrides };
  merged.maxReplyWords = clampReplyWords(merged.maxReplyWords);
  return merged;
}

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.chunkSizeTokens`. */
export const STUDY_CHUNK_SIZE_TOKENS = DEFAULT_STUDY_PIPELINE_CONFIG.chunkSizeTokens;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.chunkOverlapTokens`. */
export const STUDY_CHUNK_OVERLAP_TOKENS = DEFAULT_STUDY_PIPELINE_CONFIG.chunkOverlapTokens;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.vectorTopK`. */
export const STUDY_RAG_VECTOR_TOP_K = DEFAULT_STUDY_PIPELINE_CONFIG.vectorTopK;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.bm25TopK`. */
export const STUDY_RAG_BM25_TOP_K = DEFAULT_STUDY_PIPELINE_CONFIG.bm25TopK;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.fuseTopK`. */
export const STUDY_RAG_FUSE_TOP_K = DEFAULT_STUDY_PIPELINE_CONFIG.fuseTopK;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.minVectorScore`. */
export const STUDY_RAG_MIN_VECTOR_SCORE = DEFAULT_STUDY_PIPELINE_CONFIG.minVectorScore;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.minLexicalOverlap`. */
export const STUDY_RAG_MIN_LEXICAL_OVERLAP = DEFAULT_STUDY_PIPELINE_CONFIG.minLexicalOverlap;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.temperature`. */
export const STUDY_RAG_TEMPERATURE = DEFAULT_STUDY_PIPELINE_CONFIG.temperature;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.temperatureRetry`. */
export const STUDY_RAG_TEMPERATURE_RETRY = DEFAULT_STUDY_PIPELINE_CONFIG.temperatureRetry;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.nPredict`. */
export const STUDY_RAG_N_PREDICT = DEFAULT_STUDY_PIPELINE_CONFIG.nPredict;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.usearchConnectivity`. */
export const USEARCH_CONNECTIVITY = DEFAULT_STUDY_PIPELINE_CONFIG.usearchConnectivity;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.usearchExpansionAdd`. */
export const USEARCH_EXPANSION_ADD = DEFAULT_STUDY_PIPELINE_CONFIG.usearchExpansionAdd;

/** @deprecated Prefer `DEFAULT_STUDY_PIPELINE_CONFIG.usearchExpansionSearch`. */
export const USEARCH_EXPANSION_SEARCH = DEFAULT_STUDY_PIPELINE_CONFIG.usearchExpansionSearch;

export function estimateTokenCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / STUDY_CHARS_PER_TOKEN));
}

export function tokensToCharBudget(tokens: number): number {
  return Math.max(1, Math.floor(tokens * STUDY_CHARS_PER_TOKEN));
}
