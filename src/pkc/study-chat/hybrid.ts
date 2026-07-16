/**
 * Hybrid retrieval fusion (annadata HybridSearchService pattern).
 */

export interface RankedChunk {
  chunkId: string;
  text: string;
  score: number;
}

interface FusedEntry {
  chunkId: string;
  text: string;
  score: number;
}

/** Min-max normalize each list, sum per chunkId, take top `cap`. */
export function fuseRankedLists(
  vector: RankedChunk[],
  bm25: RankedChunk[],
  cap: number,
): RankedChunk[] {
  if (cap <= 0) return [];

  const combined = new Map<string, FusedEntry>();
  accumulate(combined, normalizeScores(vector));
  accumulate(combined, normalizeScores(bm25));

  const fused = Array.from(combined.values());
  fused.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
  });

  return fused.slice(0, cap).map((entry) => ({
    chunkId: entry.chunkId,
    text: entry.text,
    score: entry.score,
  }));
}

function normalizeScores(list: RankedChunk[]): RankedChunk[] {
  if (list.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const item of list) {
    if (item.score < min) min = item.score;
    if (item.score > max) max = item.score;
  }
  const range = max - min;
  return list.map((item) => ({
    ...item,
    score: range === 0 ? 1 : (item.score - min) / range,
  }));
}

function accumulate(into: Map<string, FusedEntry>, list: RankedChunk[]): void {
  for (const item of list) {
    const prev = into.get(item.chunkId);
    if (prev) {
      prev.score += item.score;
      if (item.text && !prev.text) prev.text = item.text;
    } else {
      into.set(item.chunkId, {
        chunkId: item.chunkId,
        text: item.text,
        score: item.score,
      });
    }
  }
}
