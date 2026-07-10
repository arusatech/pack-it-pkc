/**
 * Active model selection + ensure download + load into a GgufInferenceProvider.
 */

import {
  downloadModel,
  getModelLocalPath,
  type DownloadProgress,
} from "./download-model.js";
import {
  isChatCapableModel,
  LFM2_CHAT_MODEL_ID,
  type ModelCatalogEntry,
  createModelCatalog,
} from "./model-catalog.js";
import type { GgufInferenceProvider } from "./types.js";

const ACTIVE_MODEL_STORAGE_KEY = "pack-it-pkc:active-model-id";

let activeModelIdMemory: string | null = null;
let loadedModelId: string | null = null;

function readStoredActiveModelId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredActiveModelId(modelId: string | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (modelId) localStorage.setItem(ACTIVE_MODEL_STORAGE_KEY, modelId);
    else localStorage.removeItem(ACTIVE_MODEL_STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export function setActiveModelId(modelId: string): void {
  activeModelIdMemory = modelId;
  writeStoredActiveModelId(modelId);
}

export function getActiveModelId(): string {
  return activeModelIdMemory ?? readStoredActiveModelId() ?? LFM2_CHAT_MODEL_ID;
}

export function getLoadedModelId(): string | null {
  return loadedModelId;
}

export function clearLoadedModelId(): void {
  loadedModelId = null;
}

export type EnsureModelReadyOptions = {
  onProgress?: (progress: DownloadProgress) => void;
  onStatus?: (message: string) => void;
  /** When true (default), refuse embeddings-only models for chat/assist. */
  requireChatCapable?: boolean;
};

/**
 * Download if missing, then `provider.loadModel({ modelPath })`.
 * Returns the local path used.
 */
export async function ensureModelReady(
  provider: GgufInferenceProvider,
  modelId: string = getActiveModelId(),
  options: EnsureModelReadyOptions = {},
): Promise<{ modelId: string; path: string }> {
  const requireChat = options.requireChatCapable !== false;
  if (requireChat && !isChatCapableModel(modelId)) {
    throw new Error(
      `Model '${modelId}' is not chat-capable. Choose a chat model (e.g. ${LFM2_CHAT_MODEL_ID}).`,
    );
  }

  options.onStatus?.(`Checking model ${modelId}…`);
  let path = await getModelLocalPath(modelId);
  if (!path) {
    options.onStatus?.(`Downloading ${modelId}…`);
    const info = await downloadModel(modelId, { onProgress: options.onProgress });
    path = info.path;
  }

  if (loadedModelId === modelId) {
    options.onStatus?.(`Model ${modelId} already loaded`);
    return { modelId, path };
  }

  options.onStatus?.(`Loading ${modelId}…`);
  await provider.loadModel({ modelPath: path });
  loadedModelId = modelId;
  setActiveModelId(modelId);
  options.onStatus?.(`Model ${modelId} ready`);
  return { modelId, path };
}

/** Catalog entries with downloaded status filled from local storage. */
export async function listModelsWithStatus(): Promise<ModelCatalogEntry[]> {
  const { listDownloadedModels } = await import("./download-model.js");
  const downloaded = new Set((await listDownloadedModels()).map((m) => m.modelId));
  return createModelCatalog().map((entry) => ({
    ...entry,
    status: downloaded.has(entry.id) ? "downloaded" : entry.status,
  }));
}
