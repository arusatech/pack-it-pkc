import type {
  ChatMessage,
  CompletionOptions,
  GgufInferenceProvider,
  VisionRequest,
} from "./types.js";
import { toBase64 } from "../utils/binary.js";

type CapacitorLlama = {
  initLlama: (opts: {
    modelPath: string;
    contextId?: number;
    embedding?: boolean;
  }) => Promise<{ contextId: number }>;
  releaseContext: (opts: { contextId: number }) => Promise<void>;
  completion: (opts: {
    contextId: number;
    prompt: string;
    n_predict?: number;
    temperature?: number;
  }) => Promise<{ text: string }>;
  embedding?: (opts: {
    contextId: number;
    text: string;
  }) => Promise<{ embedding: number[] }>;
  multimodalCompletion?: (opts: {
    contextId: number;
    prompt: string;
    imagePaths?: string[];
    imageData?: string[];
    n_predict?: number;
  }) => Promise<{ text: string }>;
};

/**
 * GGUF provider for desktop, iOS, Android, and PWA via llama-cpp-capacitor.
 * Requires peer dependency: llama-cpp-capacitor
 */
export class CapacitorGgufProvider implements GgufInferenceProvider {
  readonly platform = "capacitor" as const;
  private llama: CapacitorLlama | null = null;
  private contextId = 0;
  private modelPath = "";
  private embeddingMode = false;

  static async create(): Promise<CapacitorGgufProvider> {
    const provider = new CapacitorGgufProvider();
    const mod = await import("llama-cpp-capacitor");
    provider.llama = (mod.LlamaCpp ?? mod.default ?? mod) as CapacitorLlama;
    return provider;
  }

  async loadModel(options: {
    modelPath: string;
    contextId?: number;
    embedding?: boolean;
  }): Promise<void> {
    if (!this.llama) throw new Error("CapacitorGgufProvider not initialized. Call create() first.");
    this.modelPath = options.modelPath;
    this.embeddingMode = options.embedding === true;
    const result = await this.llama.initLlama({
      modelPath: options.modelPath,
      contextId: options.contextId ?? 0,
      embedding: this.embeddingMode,
    });
    this.contextId = result.contextId;
  }

  async unloadModel(contextId?: number): Promise<void> {
    await this.llama?.releaseContext({ contextId: contextId ?? this.contextId });
    this.embeddingMode = false;
  }

  async complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string> {
    if (!this.llama) throw new Error("Model not loaded");
    if (this.embeddingMode) {
      throw new Error("Current model is loaded in embedding mode; load a chat model for complete().");
    }
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n") + "\nassistant:";
    const result = await this.llama.completion({
      contextId: this.contextId,
      prompt,
      n_predict: options?.maxTokens ?? 512,
      temperature: options?.temperature ?? 0.7,
    });
    return result.text;
  }

  async embedText(text: string): Promise<number[]> {
    if (!this.llama) throw new Error("Model not loaded");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Text is required for embedding.");
    if (!this.llama.embedding) {
      throw new Error("llama-cpp-capacitor embedding API is not available in this build.");
    }
    const result = await this.llama.embedding({
      contextId: this.contextId,
      text: trimmed,
    });
    if (!result?.embedding?.length) throw new Error("Empty embedding from runtime.");
    return result.embedding;
  }

  async describeImage(request: VisionRequest): Promise<string | null> {
    if (!this.llama?.multimodalCompletion) return null;
    const base64 = bytesToBase64(request.bytes);
    const result = await this.llama.multimodalCompletion({
      contextId: this.contextId,
      prompt: request.prompt,
      imageData: [`data:${request.mimeType};base64,${base64}`],
      n_predict: 512,
    });
    return result.text;
  }

  async describeDocument(request: VisionRequest): Promise<string | null> {
    return this.describeImage(request);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return toBase64(bytes);
}
