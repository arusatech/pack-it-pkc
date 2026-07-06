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
  readonly platform: "capacitor" | "node" | "web";

  loadModel(options: { modelPath: string; contextId?: number }): Promise<void>;
  unloadModel?(contextId?: number): Promise<void>;

  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string>;

  /** Multimodal: describe an image using a vision GGUF model */
  describeImage?(request: VisionRequest): Promise<string | null>;

  /** Multimodal: OCR / layout extraction for PDF or scanned docs */
  describeDocument?(request: VisionRequest): Promise<string | null>;
}

export type GgufProviderFactory = () => Promise<GgufInferenceProvider>;
