/**
 * Shared local GGUF catalog — browser (OPFS) and Node cache.
 */

export const DEFAULT_OFFLINE_MODEL_ID = "bge_micro_v2";

export const LFM2_CHAT_MODEL_ID = "lfm2_1_2b_rag_q4_k_m" as const;

export const CHAT_MODEL_IDS = [LFM2_CHAT_MODEL_ID] as const;

export const EMBEDDING_MODEL_IDS = new Set<string>([DEFAULT_OFFLINE_MODEL_ID]);

/** Output dimension of bge-micro-v2. */
export const BGE_EMBEDDING_DIMENSION = 384;

export const BGE_MICRO_V2_GGUF_URL =
  "https://huggingface.co/mradermacher/bge-micro-v2-GGUF/resolve/main/bge-micro-v2.Q4_K_M.gguf";

export const LFM2_CHAT_MODEL_GGUF_URL =
  "https://huggingface.co/bartowski/LiquidAI_LFM2-1.2B-RAG-GGUF/resolve/main/LiquidAI_LFM2-1.2B-RAG-Q4_K_M.gguf";

export type ModelCatalogStatus = "available" | "downloading" | "downloaded" | "error";

export type ModelCatalogEntry = {
  id: string;
  name: string;
  sizeMB: number;
  status: ModelCatalogStatus;
  path?: string;
  description?: string;
  url?: string;
  size?: number;
};

/** Deep-clone catalog entries for mutable download status per app. */
export function createModelCatalog(): ModelCatalogEntry[] {
  return [
    {
      id: DEFAULT_OFFLINE_MODEL_ID,
      name: "BGE-Embeddings",
      sizeMB: 16.8,
      size: 17_572_160,
      status: "available",
      description: "Embeddings only (not for chat / formula assist)",
      url: BGE_MICRO_V2_GGUF_URL,
    },
    {
      id: LFM2_CHAT_MODEL_ID,
      name: "LFM2 RAG Chat",
      sizeMB: 697.4,
      size: 730_894_880,
      status: "available",
      description: "On-device chat (Q4_K_M); formula / math AI assist",
      url: LFM2_CHAT_MODEL_GGUF_URL,
    },
  ];
}

export function getModelById(
  modelId: string,
  catalog: ModelCatalogEntry[] = createModelCatalog(),
): ModelCatalogEntry | undefined {
  return catalog.find((m) => m.id === modelId);
}

export function modelUrlForId(
  modelId: string,
  catalog: ModelCatalogEntry[] = createModelCatalog(),
): string | undefined {
  return getModelById(modelId, catalog)?.url;
}

export function isChatCapableModel(modelId: string): boolean {
  return (CHAT_MODEL_IDS as readonly string[]).includes(modelId);
}

/** Alias used by apps that prefer listModels naming. */
export function listModels(): ModelCatalogEntry[] {
  return createModelCatalog();
}
