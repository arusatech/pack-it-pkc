/**
 * Study PKC retrieval: FlexSearch BM25 + BGE vector hybrid via USearch / exact cosine.
 * Off-topic queries (weak cosine + no lexical overlap) return empty snippets → "not found".
 */

import type { GgufInferenceProvider } from "../../inference/types.js";
import { ensureEmbeddingModelReady } from "../../inference/model-session.js";
import {
  BGE_EMBEDDING_DIMENSION,
  DEFAULT_OFFLINE_MODEL_ID,
} from "../../inference/model-catalog.js";
import {
  resolveStudyPipelineConfig,
  type StudyPipelineConfig,
} from "../study-rag-config.js";
import type { PkcStudyDocument } from "../study-types.js";
import { createStudyVectorIndex } from "../vector/create-index.js";
import type { StudyVectorIndex } from "../vector/types.js";
import { studyBm25 } from "./bm25.js";
import { fuseRankedLists, type RankedChunk } from "./hybrid.js";
import { assessStudyRetrievalRelevance } from "./relevance.js";

export type StudyRetrieveMode = "hybrid" | "bm25-only" | "bm25-no-vectors" | "no-match";

export interface StudyRetrieveResult {
  snippets: string[];
  ranked: RankedChunk[];
  mode: StudyRetrieveMode;
  /** Which dense index backed the vector arm (when hybrid). */
  vectorBackend?: StudyVectorIndex["backend"];
  /** Why retrieval was accepted or rejected. */
  relevance?: ReturnType<typeof assessStudyRetrievalRelevance>;
}

export type RetrieveStudyContextOptions = {
  provider?: GgufInferenceProvider | null;
  /** When true, load BGE and run vector arm (slower: swaps out chat model). */
  useVectors?: boolean;
  /** Host pipeline overrides (merged with defaults). */
  pipeline?: Partial<StudyPipelineConfig>;
  /** Explicit Top_K overrides (win over pipeline when set). */
  bm25Limit?: number;
  vectorLimit?: number;
  fuseCap?: number;
  onStatus?: (msg: string) => void;
};

/** Build searchable corpus: RAG chunks + flash cards + MCQs. */
export function collectStudySearchChunks(
  doc: PkcStudyDocument,
): Array<{ chunkId: string; text: string; embedding?: number[] }> {
  const out: Array<{ chunkId: string; text: string; embedding?: number[] }> = [];

  for (const c of doc.chunks ?? []) {
    const text = (c.text ?? "").trim();
    if (!text) continue;
    out.push({
      chunkId: c.chunkId || `chunk-${out.length}`,
      text,
      embedding: c.embedding?.length ? c.embedding : undefined,
    });
  }

  for (const fc of doc.flashCards ?? []) {
    const text = [fc.info, fc.solution?.text].filter(Boolean).join("\n").trim();
    if (!text) continue;
    out.push({ chunkId: `flash:${fc.id}`, text });
  }

  for (const m of doc.mcqs ?? []) {
    const text = [m.question, ...(m.options ?? []), m.explanation]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) continue;
    out.push({ chunkId: `mcq:${m.id}`, text });
  }

  if (out.length === 0 && doc.markdown?.trim()) {
    const parts = doc.markdown
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40);
    parts.forEach((text, i) => out.push({ chunkId: `md-${i}`, text }));
  }

  return out;
}

function docIndexKey(doc: PkcStudyDocument): string {
  return `${doc.source ?? "study"}|${doc.createdAt}|${doc.stats?.chunkCount ?? 0}|${doc.flashCards?.length ?? 0}|${doc.mcqs?.length ?? 0}|${doc.stats?.embeddedChunkCount ?? 0}`;
}

function ensureBm25Index(doc: PkcStudyDocument): string {
  const key = docIndexKey(doc);
  if (!studyBm25.has(key)) {
    studyBm25.buildIndex(
      key,
      collectStudySearchChunks(doc).map((c) => ({ chunkId: c.chunkId, text: c.text })),
    );
  }
  return key;
}

type CachedVectorIndex = {
  key: string;
  index: StudyVectorIndex;
};

const vectorIndexCache = new Map<string, CachedVectorIndex>();

async function ensureVectorIndex(
  doc: PkcStudyDocument,
  withVectors: Array<{ chunkId: string; text: string; embedding: number[] }>,
  pipeline: StudyPipelineConfig,
): Promise<StudyVectorIndex> {
  const key = docIndexKey(doc);
  const cached = vectorIndexCache.get(key);
  if (cached && cached.index.size() === withVectors.length) {
    return cached.index;
  }

  const dimensions =
    withVectors[0]?.embedding.length ??
    doc.models?.embeddingDimensions ??
    pipeline.embeddingDimensions ??
    BGE_EMBEDDING_DIMENSION;
  const index = await createStudyVectorIndex(dimensions, {
    usearchConnectivity: pipeline.usearchConnectivity,
    usearchExpansionAdd: pipeline.usearchExpansionAdd,
    usearchExpansionSearch: pipeline.usearchExpansionSearch,
  });
  index.add(
    withVectors.map((c) => ({
      chunkId: c.chunkId,
      text: c.text,
      embedding: c.embedding,
    })),
  );
  vectorIndexCache.set(key, { key, index });
  return index;
}

/** Drop cached dense indexes (tests / memory pressure). */
export function clearStudyVectorIndexCache(): void {
  vectorIndexCache.clear();
}

function attachBestVectorScores(
  fused: RankedChunk[],
  vectorHits: RankedChunk[],
): RankedChunk[] {
  const byId = new Map(vectorHits.map((h) => [h.chunkId, h.vectorScore ?? h.score]));
  return fused.map((h) => ({
    ...h,
    vectorScore: byId.get(h.chunkId),
  }));
}

function gateRelevant(
  query: string,
  ranked: RankedChunk[],
  mode: StudyRetrieveMode,
  pipeline: StudyPipelineConfig,
  vectorBackend?: StudyVectorIndex["backend"],
): StudyRetrieveResult {
  const relevance = assessStudyRetrievalRelevance(query, ranked, {
    minVectorScore: pipeline.minVectorScore,
    minLexicalOverlap: pipeline.minLexicalOverlap,
  });
  if (!relevance.relevant || ranked.length === 0) {
    return {
      snippets: [],
      ranked: [],
      mode: "no-match",
      vectorBackend,
      relevance,
    };
  }
  return {
    snippets: ranked.map((r) => r.text).filter(Boolean),
    ranked,
    mode,
    vectorBackend,
    relevance,
  };
}

export async function retrieveStudyContext(
  doc: PkcStudyDocument,
  query: string,
  opts?: RetrieveStudyContextOptions,
): Promise<StudyRetrieveResult> {
  const q = query.trim();
  const pipeline = resolveStudyPipelineConfig(opts?.pipeline);
  const bm25Limit = opts?.bm25Limit ?? pipeline.bm25TopK;
  const vectorLimit = opts?.vectorLimit ?? pipeline.vectorTopK;
  const fuseCap = opts?.fuseCap ?? pipeline.fuseTopK;

  const indexKey = ensureBm25Index(doc);
  const bm25Hits = studyBm25.search(indexKey, q, bm25Limit).map(
    (h): RankedChunk => ({
      chunkId: h.chunkId,
      text: h.text,
      score: h.score,
    }),
  );

  const corpus = collectStudySearchChunks(doc);
  const withVectors = corpus.filter(
    (c): c is { chunkId: string; text: string; embedding: number[] } =>
      !!c.embedding && c.embedding.length > 0,
  );
  const provider = opts?.provider ?? null;
  const wantVectors = opts?.useVectors !== false && withVectors.length > 0 && !!provider?.embedText;

  if (!wantVectors) {
    const ranked = bm25Hits.slice(0, fuseCap);
    return gateRelevant(
      q,
      ranked,
      withVectors.length ? "bm25-only" : "bm25-no-vectors",
      pipeline,
    );
  }

  try {
    opts?.onStatus?.("Embedding query for hybrid retrieval…");
    await ensureEmbeddingModelReady(provider!, DEFAULT_OFFLINE_MODEL_ID, {
      onStatus: opts?.onStatus,
      nCtx: pipeline.embeddingNCtx,
    });
    const queryVec = await provider!.embedText!(q);
    opts?.onStatus?.("Searching USearch / vector index…");
    const vectorIndex = await ensureVectorIndex(doc, withVectors, pipeline);
    const vectorHits = vectorIndex
      .search(queryVec, vectorLimit)
      .filter((h) => h.score >= pipeline.minVectorScore)
      .map(
        (h): RankedChunk => ({
          chunkId: h.chunkId,
          text: h.text,
          score: h.score,
          vectorScore: h.score,
        }),
      );

    const fused = attachBestVectorScores(
      fuseRankedLists(vectorHits, bm25Hits, fuseCap),
      vectorHits,
    );
    return gateRelevant(q, fused, "hybrid", pipeline, vectorIndex.backend);
  } catch {
    const ranked = bm25Hits.slice(0, fuseCap);
    return gateRelevant(q, ranked, "bm25-only", pipeline);
  }
}
