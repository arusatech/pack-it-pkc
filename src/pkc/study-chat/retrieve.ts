/**
 * Study PKC retrieval: FlexSearch BM25 + optional BGE vector hybrid.
 */

import type { GgufInferenceProvider } from "../../inference/types.js";
import { ensureEmbeddingModelReady } from "../../inference/model-session.js";
import { DEFAULT_OFFLINE_MODEL_ID } from "../../inference/model-catalog.js";
import type { PkcStudyDocument } from "../study-types.js";
import { studyBm25 } from "./bm25.js";
import { fuseRankedLists, type RankedChunk } from "./hybrid.js";

export type StudyRetrieveMode = "hybrid" | "bm25-only" | "bm25-no-vectors";

export interface StudyRetrieveResult {
  snippets: string[];
  ranked: RankedChunk[];
  mode: StudyRetrieveMode;
}

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
  return `${doc.source ?? "study"}|${doc.createdAt}|${doc.stats?.chunkCount ?? 0}|${doc.flashCards?.length ?? 0}|${doc.mcqs?.length ?? 0}`;
}

function ensureIndex(doc: PkcStudyDocument): string {
  const key = docIndexKey(doc);
  if (!studyBm25.has(key)) {
    studyBm25.buildIndex(
      key,
      collectStudySearchChunks(doc).map((c) => ({ chunkId: c.chunkId, text: c.text })),
    );
  }
  return key;
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function retrieveStudyContext(
  doc: PkcStudyDocument,
  query: string,
  opts?: {
    provider?: GgufInferenceProvider | null;
    /** When true, load BGE and run vector arm (slower: swaps out chat model). */
    useVectors?: boolean;
    bm25Limit?: number;
    vectorLimit?: number;
    fuseCap?: number;
    onStatus?: (msg: string) => void;
  },
): Promise<StudyRetrieveResult> {
  const q = query.trim();
  const bm25Limit = opts?.bm25Limit ?? 10;
  const vectorLimit = opts?.vectorLimit ?? 10;
  const fuseCap = opts?.fuseCap ?? 5;

  const indexKey = ensureIndex(doc);
  const bm25Hits = studyBm25.search(indexKey, q, bm25Limit).map(
    (h): RankedChunk => ({
      chunkId: h.chunkId,
      text: h.text,
      score: h.score,
    }),
  );

  const corpus = collectStudySearchChunks(doc);
  const withVectors = corpus.filter((c) => c.embedding && c.embedding.length > 0);
  const provider = opts?.provider ?? null;
  const wantVectors = opts?.useVectors !== false && withVectors.length > 0 && !!provider?.embedText;

  if (!wantVectors) {
    const ranked = bm25Hits.slice(0, fuseCap);
    return {
      snippets: ranked.map((r) => r.text).filter(Boolean),
      ranked,
      mode: withVectors.length ? "bm25-only" : "bm25-no-vectors",
    };
  }

  try {
    opts?.onStatus?.("Embedding query for hybrid retrieval…");
    await ensureEmbeddingModelReady(provider!, DEFAULT_OFFLINE_MODEL_ID, {
      onStatus: opts?.onStatus,
    });
    const queryVec = await provider!.embedText!(q);
    const vectorHits = withVectors
      .map((c) => ({
        chunkId: c.chunkId,
        text: c.text,
        score: cosine(queryVec, c.embedding!),
      }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, vectorLimit);

    const fused = fuseRankedLists(vectorHits, bm25Hits, fuseCap);
    return {
      snippets: fused.map((r) => r.text).filter(Boolean),
      ranked: fused,
      mode: "hybrid",
    };
  } catch {
    const ranked = bm25Hits.slice(0, fuseCap);
    return {
      snippets: ranked.map((r) => r.text).filter(Boolean),
      ranked,
      mode: "bm25-only",
    };
  }
}
