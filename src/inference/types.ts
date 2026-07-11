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
}

/**
 * Platform-agnostic GGUF inference (replaces ONNX/OpenAI for on-device vision & text).
 * Implementations: Capacitor (mobile/PWA), Node (Electron/desktop).
 */
export interface GgufInferenceProvider {
  readonly platform: "capacitor" | "node";

  loadModel(options: { modelPath: string; contextId?: number; embedding?: boolean }): Promise<void>;
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
