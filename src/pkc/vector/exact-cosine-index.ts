/**
 * Exact cosine ANN over a packed Float32 matrix.
 * Used when native USearch bindings are unavailable (browser / Capacitor WebView).
 * Correct for study-scale corpora (typically hundreds–thousands of 384-d vectors).
 */

import type { StudyVectorHit, StudyVectorIndex, StudyVectorRecord } from "./types.js";

export class ExactCosineIndex implements StudyVectorIndex {
  readonly backend = "exact-cosine" as const;
  readonly dimensions: number;

  private chunkIds: string[] = [];
  private texts: string[] = [];
  /** Row-major embeddings, length = n * dimensions. */
  private matrix = new Float32Array(0);
  private norms = new Float32Array(0);
  private count = 0;
  private capacity = 0;

  constructor(dimensions: number) {
    if (!(dimensions > 0)) {
      throw new Error(`ExactCosineIndex: dimensions must be > 0 (got ${dimensions})`);
    }
    this.dimensions = dimensions;
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.chunkIds = [];
    this.texts = [];
    this.matrix = new Float32Array(0);
    this.norms = new Float32Array(0);
    this.count = 0;
    this.capacity = 0;
  }

  add(records: StudyVectorRecord[]): void {
    const dim = this.dimensions;
    const valid = records.filter((r) => Array.isArray(r.embedding) && r.embedding.length === dim);
    if (valid.length === 0) return;

    this.ensureCapacity(this.count + valid.length);
    for (const r of valid) {
      const row = this.count;
      const offset = row * dim;
      let normSq = 0;
      for (let d = 0; d < dim; d++) {
        const v = r.embedding[d]!;
        this.matrix[offset + d] = v;
        normSq += v * v;
      }
      this.norms[row] = Math.sqrt(normSq);
      this.chunkIds[row] = r.chunkId;
      this.texts[row] = r.text;
      this.count += 1;
    }
  }

  search(query: number[], k: number): StudyVectorHit[] {
    if (k <= 0 || this.count === 0) return [];
    if (query.length !== this.dimensions) return [];

    let qNormSq = 0;
    const q = new Float32Array(this.dimensions);
    for (let d = 0; d < this.dimensions; d++) {
      const v = query[d]!;
      q[d] = v;
      qNormSq += v * v;
    }
    const qNorm = Math.sqrt(qNormSq);
    if (!(qNorm > 0)) return [];

    const dim = this.dimensions;
    const n = this.count;
    const topK = Math.min(k, n);
    const bestScores = new Float32Array(topK);
    const bestIdx = new Int32Array(topK);
    bestScores.fill(-Infinity);
    bestIdx.fill(-1);
    let filled = 0;
    let worstScore = -Infinity;
    let worstSlot = 0;

    for (let i = 0; i < n; i++) {
      const nrm = this.norms[i]!;
      if (!(nrm > 0)) continue;
      const offset = i * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) {
        dot += this.matrix[offset + d]! * q[d]!;
      }
      const score = dot / (nrm * qNorm);
      if (!(score > -1)) continue;

      if (filled < topK) {
        bestScores[filled] = score;
        bestIdx[filled] = i;
        filled += 1;
        if (filled === topK) {
          worstSlot = 0;
          worstScore = bestScores[0]!;
          for (let s = 1; s < topK; s++) {
            if (bestScores[s]! < worstScore) {
              worstScore = bestScores[s]!;
              worstSlot = s;
            }
          }
        }
        continue;
      }

      if (score <= worstScore) continue;
      bestScores[worstSlot] = score;
      bestIdx[worstSlot] = i;
      worstSlot = 0;
      worstScore = bestScores[0]!;
      for (let s = 1; s < topK; s++) {
        if (bestScores[s]! < worstScore) {
          worstScore = bestScores[s]!;
          worstSlot = s;
        }
      }
    }

    const hits: StudyVectorHit[] = [];
    for (let s = 0; s < filled; s++) {
      const idx = bestIdx[s]!;
      if (idx < 0) continue;
      hits.push({
        chunkId: this.chunkIds[idx]!,
        text: this.texts[idx]!,
        score: bestScores[s]!,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits;
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this.capacity) return;
    const next = Math.max(needed, this.capacity === 0 ? 32 : this.capacity * 2);
    const dim = this.dimensions;
    const matrix = new Float32Array(next * dim);
    const norms = new Float32Array(next);
    if (this.count > 0) {
      matrix.set(this.matrix.subarray(0, this.count * dim));
      norms.set(this.norms.subarray(0, this.count));
    }
    this.matrix = matrix;
    this.norms = norms;
    this.capacity = next;
  }
}
