/** Shared vector-index contract for study RAG (USearch or exact cosine). */

export type StudyVectorBackend = "usearch" | "exact-cosine";

export interface StudyVectorHit {
  /** Stable chunk id from the study document. */
  chunkId: string;
  /** Cosine similarity in [-1, 1] (higher is better). */
  score: number;
  text: string;
}

export interface StudyVectorRecord {
  chunkId: string;
  text: string;
  embedding: number[];
}

export interface StudyVectorIndex {
  readonly backend: StudyVectorBackend;
  readonly dimensions: number;
  size(): number;
  clear(): void;
  add(records: StudyVectorRecord[]): void;
  search(query: number[], k: number): StudyVectorHit[];
}
