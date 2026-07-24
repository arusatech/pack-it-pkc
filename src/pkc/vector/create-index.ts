/**
 * Factory: prefer native USearch (Node), else exact cosine (browser / Capacitor).
 */

import { BGE_EMBEDDING_DIMENSION } from "../../inference/model-catalog.js";
import {
  DEFAULT_STUDY_PIPELINE_CONFIG,
  type StudyPipelineConfig,
} from "../study-rag-config.js";
import { ExactCosineIndex } from "./exact-cosine-index.js";
import type { StudyVectorIndex } from "./types.js";
import { USearchVectorIndex, type USearchHnswOptions } from "./usearch-index.js";

export type CreateStudyVectorIndexOptions = Partial<
  Pick<
    StudyPipelineConfig,
    "usearchConnectivity" | "usearchExpansionAdd" | "usearchExpansionSearch"
  >
>;

function toHnswOptions(options?: CreateStudyVectorIndexOptions): USearchHnswOptions {
  return {
    connectivity: options?.usearchConnectivity ?? DEFAULT_STUDY_PIPELINE_CONFIG.usearchConnectivity,
    expansionAdd: options?.usearchExpansionAdd ?? DEFAULT_STUDY_PIPELINE_CONFIG.usearchExpansionAdd,
    expansionSearch:
      options?.usearchExpansionSearch ?? DEFAULT_STUDY_PIPELINE_CONFIG.usearchExpansionSearch,
  };
}

export async function createStudyVectorIndex(
  dimensions: number = BGE_EMBEDDING_DIMENSION,
  options?: CreateStudyVectorIndexOptions,
): Promise<StudyVectorIndex> {
  const usearch = await USearchVectorIndex.tryCreate(dimensions, toHnswOptions(options));
  if (usearch) return usearch;
  return new ExactCosineIndex(dimensions);
}

/** Sync exact index — useful in tests and when async factory is unnecessary. */
export function createExactStudyVectorIndex(
  dimensions: number = BGE_EMBEDDING_DIMENSION,
): StudyVectorIndex {
  return new ExactCosineIndex(dimensions);
}
