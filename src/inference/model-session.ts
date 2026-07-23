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
  DEFAULT_OFFLINE_MODEL_ID,
  type ModelCatalogEntry,
  createModelCatalog,
} from "./model-catalog.js";
import { explainModelFailure } from "./model-errors.js";
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

  try {
    options.onStatus?.(`Checking model ${modelId}…`);
    let path = await getModelLocalPath(modelId);
    if (!path) {
      options.onStatus?.(
        `Downloading ${modelId}… (needs free disk/browser storage; chat models can be ~700 MB)`,
      );
      try {
        const info = await downloadModel(modelId, { onProgress: options.onProgress });
        path = info.path;
      } catch (err) {
        throw new Error(explainModelFailure(modelId, err, "download"));
      }
    }

    if (loadedModelId === modelId) {
      options.onStatus?.(`Model ${modelId} already loaded`);
      return { modelId, path };
    }

    options.onStatus?.(
      `Loading ${modelId} into memory… (needs free RAM; may take several minutes)`,
    );
    const loadOpts: {
      modelPath: string;
      modelId: string;
      onProgress?: (p: number) => void;
    } = {
      modelPath: path,
      modelId,
    };
    if (options.onStatus) {
      loadOpts.onProgress = (p) => {
        const pct = Number.isFinite(p) ? Math.round(Math.min(100, Math.max(0, p * 100))) : 0;
        options.onStatus?.(
          `Loading ${modelId}… ${pct}% (if this stalls, free RAM/disk or cancel and use rule-based cards)`,
        );
      };
    }
    try {
      await provider.loadModel(loadOpts);
    } catch (err) {
      throw new Error(explainModelFailure(modelId, err, "load"));
    }
    loadedModelId = modelId;
    setActiveModelId(modelId);
    options.onStatus?.(`Model ${modelId} ready`);
    return { modelId, path };
  } catch (err) {
    if (err instanceof Error && err.message.includes("Not enough")) throw err;
    if (err instanceof Error && /Could not (download|load)|timed out|Skipped/i.test(err.message)) {
      throw err;
    }
    throw new Error(explainModelFailure(modelId, err, "load"));
  }
}

/**
 * Download/load the embedding catalog model (BGE) for `provider.embedText`.
 * Clears the chat "loaded" marker so a later ensureModelReady reloads chat.
 */
export async function ensureEmbeddingModelReady(
  provider: GgufInferenceProvider,
  modelId: string = DEFAULT_OFFLINE_MODEL_ID,
  options: EnsureModelReadyOptions = {},
): Promise<{ modelId: string; path: string }> {
  if (isChatCapableModel(modelId)) {
    throw new Error(`Model '${modelId}' is chat-capable; use an embedding model (e.g. ${DEFAULT_OFFLINE_MODEL_ID}).`);
  }
  if (typeof provider.embedText !== "function") {
    throw new Error("Provider does not implement embedText().");
  }

  try {
    options.onStatus?.(`Checking embedding model ${modelId}…`);
    let path = await getModelLocalPath(modelId);
    if (!path) {
      options.onStatus?.(
        `Downloading embedding model ${modelId}… (needs a little free disk/browser storage)`,
      );
      try {
        const info = await downloadModel(modelId, { onProgress: options.onProgress });
        path = info.path;
      } catch (err) {
        throw new Error(explainModelFailure(modelId, err, "download"));
      }
    }

    options.onStatus?.(`Loading embedding model ${modelId} into memory…`);
    try {
      await provider.loadModel({
        modelPath: path,
        modelId,
        embedding: true,
        ...(options.onStatus
          ? {
              onProgress: (p: number) => {
                const pct = Number.isFinite(p) ? Math.round(Math.min(100, Math.max(0, p * 100))) : 0;
                options.onStatus?.(
                  `Loading embedding model ${modelId}… ${pct}% (uses cached file if already downloaded)`,
                );
              },
            }
          : {}),
      });
    } catch (err) {
      throw new Error(explainModelFailure(modelId, err, "load"));
    }
    loadedModelId = null; // chat must be reloaded after embed phase
    options.onStatus?.(`Embedding model ${modelId} ready`);
    return { modelId, path };
  } catch (err) {
    if (err instanceof Error && /Could not (download|load)|Not enough|timed out/i.test(err.message)) {
      throw err;
    }
    throw new Error(explainModelFailure(modelId, err, "load"));
  }
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
