/**
 * Guardrails so study chat refuses off-topic queries (e.g. "Pythagoras" on an
 * electrochemistry PKC) instead of letting a small LLM hallucinate.
 */

import {
  STUDY_RAG_MIN_LEXICAL_OVERLAP,
  STUDY_RAG_MIN_VECTOR_SCORE,
} from "../study-rag-config.js";
import type { RankedChunk } from "./hybrid.js";

const STOP = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "has",
  "have",
  "been",
  "were",
  "what",
  "when",
  "who",
  "how",
  "why",
  "with",
  "this",
  "that",
  "from",
  "they",
  "them",
  "then",
  "than",
  "into",
  "about",
  "which",
  "their",
  "there",
  "would",
  "could",
  "should",
  "does",
  "did",
  "its",
  "it's",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "is",
  "it",
  "as",
  "at",
  "by",
  "or",
  "be",
]);

/** Significant query terms (len > 2, not stopwords). */
export function significantQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Fraction of significant query terms that appear (substring) in the passage. */
export function lexicalOverlapRatio(query: string, passage: string): number {
  const terms = significantQueryTerms(query);
  if (terms.length === 0) return 0;
  const hay = passage.toLowerCase();
  let hits = 0;
  for (const t of terms) {
    if (hay.includes(t)) {
      hits += 1;
      continue;
    }
    // Light fuzzy: allow small typos for longer terms (Pythagarus ≈ Pythagoras).
    if (t.length >= 6 && fuzzyTermInPassage(t, hay)) hits += 1;
  }
  return hits / terms.length;
}

function fuzzyTermInPassage(term: string, hay: string): boolean {
  const maxEdits = term.length >= 8 ? 2 : 1;
  const tokens = hay.split(/\W+/).filter((w) => w.length >= 4);
  for (const w of tokens) {
    if (Math.abs(w.length - term.length) > maxEdits) continue;
    if (levenshtein(term, w) <= maxEdits) return true;
  }
  return false;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const prev = new Array<number>(lb + 1);
  const cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= lb; j++) prev[j] = cur[j]!;
  }
  return prev[lb]!;
}

export interface RetrievalRelevance {
  relevant: boolean;
  reason: "vector" | "lexical" | "none";
  bestVectorScore: number;
  bestLexicalOverlap: number;
}

/**
 * Decide whether fused retrieval is on-topic for the query.
 * USearch always returns nearest neighbors — low cosine must be treated as miss.
 */
export function assessStudyRetrievalRelevance(
  query: string,
  ranked: RankedChunk[],
  opts?: {
    minVectorScore?: number;
    minLexicalOverlap?: number;
  },
): RetrievalRelevance {
  const minVec = opts?.minVectorScore ?? STUDY_RAG_MIN_VECTOR_SCORE;
  const minLex = opts?.minLexicalOverlap ?? STUDY_RAG_MIN_LEXICAL_OVERLAP;

  let bestVectorScore = 0;
  let bestLexicalOverlap = 0;

  for (const hit of ranked) {
    const vs = hit.vectorScore;
    if (typeof vs === "number" && vs > bestVectorScore) {
      bestVectorScore = vs;
    }
    const lex = lexicalOverlapRatio(query, hit.text ?? "");
    if (lex > bestLexicalOverlap) bestLexicalOverlap = lex;
  }

  if (bestLexicalOverlap >= minLex) {
    return {
      relevant: true,
      reason: "lexical",
      bestVectorScore,
      bestLexicalOverlap,
    };
  }

  // Vector-only accept when cosine is clearly on-topic (semantic paraphrase).
  // Do not use fused BM25 scores here — those are not cosine.
  if (bestVectorScore >= minVec) {
    return {
      relevant: true,
      reason: "vector",
      bestVectorScore,
      bestLexicalOverlap,
    };
  }

  return {
    relevant: false,
    reason: "none",
    bestVectorScore,
    bestLexicalOverlap,
  };
}
