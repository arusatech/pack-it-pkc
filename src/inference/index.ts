export type {
  GgufInferenceProvider,
  GgufProviderFactory,
  VisionRequest,
  ChatMessage,
  CompletionOptions,
} from "./types.js";

export {
  DEFAULT_OFFLINE_MODEL_ID,
  LFM2_CHAT_MODEL_ID,
  CHAT_MODEL_IDS,
  EMBEDDING_MODEL_IDS,
  BGE_EMBEDDING_DIMENSION,
  BGE_MICRO_V2_GGUF_URL,
  LFM2_CHAT_MODEL_GGUF_URL,
  createModelCatalog,
  getModelById,
  modelUrlForId,
  isChatCapableModel,
  listModels,
  type ModelCatalogEntry,
  type ModelCatalogStatus,
} from "./model-catalog.js";

export {
  downloadModel,
  download_model,
  isModelDownloaded,
  listDownloadedModels,
  getModelLocalPath,
  deleteModel,
  type DownloadProgress,
  type DownloadedModelInfo,
  type DownloadModelOptions,
} from "./download-model.js";

export {
  setActiveModelId,
  getActiveModelId,
  getLoadedModelId,
  clearLoadedModelId,
  ensureModelReady,
  listModelsWithStatus,
  type EnsureModelReadyOptions,
} from "./model-session.js";
