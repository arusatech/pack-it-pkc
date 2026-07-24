/**
 * Factory: prefer native USearch (Node), else exact cosine (browser / Capacitor).
 */

import { BGE_EMBEDDING_DIMENSION } from "../../inference/model-catalog.js";
import { ExactCosineIndex } from "./exact-cosine-index.js";
import type { StudyVectorIndex } from "./types.js";
import { USearchVectorIndex } from "./usearch-index.js";

export async function createStudyVectorIndex(
  dimensions: number = BGE_EMBEDDING_DIMENSION,
): Promise<StudyVectorIndex> {
  const usearch = await USearchVectorIndex.tryCreate(dimensions);
  if (usearch) return usearch;
  return new ExactCosineIndex(dimensions);
}

/** Sync exact index — useful in tests and when async factory is unnecessary. */
export function createExactStudyVectorIndex(
  dimensions: number = BGE_EMBEDDING_DIMENSION,
): StudyVectorIndex {
  return new ExactCosineIndex(dimensions);
}
