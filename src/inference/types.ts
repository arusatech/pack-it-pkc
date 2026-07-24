export interface VisionRequest {
  bytes: Uint8Array;
  mimeType: string;
  prompt: string;
  model?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  /** Raw prompt (e.g. SmolLM2 ChatML). When set, `messages` are ignored. */
  prompt?: string;
  /** Stop sequences for completion. */
  stop?: string[];
  /** Sampling top-k (forwarded to llama-cpp when supported). */
  topK?: number;
  /** Sampling top-p / nucleus (forwarded to llama-cpp when supported). */
  topP?: number;
}

export type LoadModelOptions = {
  modelPath: string;
  /** Catalog id when known (preferred over inferring from path). */
  modelId?: string;
  contextId?: number;
  embedding?: boolean;
  /** Override llama.cpp n_ctx (chat default 2048, embed default 512). */
  nCtx?: number;
  /** Override llama.cpp n_batch. */
  nBatch?: number;
  /** Override llama.cpp n_gpu_layers (default 99). */
  nGpuLayers?: number;
  onProgress?: (progress: number) => void;
};

/**
 * Platform-agnostic GGUF inference (replaces ONNX/OpenAI for on-device vision & text).
 * Implementation: CapacitorGgufProvider via llama-cpp-pro (desktop, iOS, Android, PWA).
 */
export interface GgufInferenceProvider {
  readonly platform: "capacitor";

  loadModel(options: LoadModelOptions): Promise<void>;
  unloadModel?(contextId?: number): Promise<void>;

  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string>;

  /** Dense embedding for the currently loaded embedding model (e.g. BGE). */
  embedText?(text: string): Promise<number[]>;

  /** Multimodal: describe an image using a vision GGUF model */
  describeImage?(request: VisionRequest): Promise<string | null>;

  /** Multimodal: OCR / layout extraction for PDF or scanned docs */
  describeDocument?(request: VisionRequest): Promise<string | null>;
}

export type GgufProviderFactory = () => Promise<GgufInferenceProvider>;
