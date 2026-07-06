import type {
  ChatMessage,
  CompletionOptions,
  GgufInferenceProvider,
  VisionRequest,
} from "./types.js";

type CapacitorLlama = {
  initLlama: (opts: { modelPath: string; contextId?: number }) => Promise<{ contextId: number }>;
  releaseContext: (opts: { contextId: number }) => Promise<void>;
  completion: (opts: {
    contextId: number;
    prompt: string;
    n_predict?: number;
    temperature?: number;
  }) => Promise<{ text: string }>;
  multimodalCompletion?: (opts: {
    contextId: number;
    prompt: string;
    imagePaths?: string[];
    imageData?: string[];
    n_predict?: number;
  }) => Promise<{ text: string }>;
};

/**
 * GGUF provider for Capacitor mobile apps and PWA (WASM + OPFS).
 * Requires peer dependency: llama-cpp-capacitor
 */
export class CapacitorGgufProvider implements GgufInferenceProvider {
  readonly platform = "capacitor" as const;
  private llama: CapacitorLlama | null = null;
  private contextId = 0;
  private modelPath = "";

  static async create(): Promise<CapacitorGgufProvider> {
    const provider = new CapacitorGgufProvider();
    const mod = await import("llama-cpp-capacitor");
    provider.llama = (mod.LlamaCpp ?? mod.default ?? mod) as CapacitorLlama;
    return provider;
  }

  async loadModel(options: { modelPath: string; contextId?: number }): Promise<void> {
    if (!this.llama) throw new Error("CapacitorGgufProvider not initialized. Call create() first.");
    this.modelPath = options.modelPath;
    const result = await this.llama.initLlama({
      modelPath: options.modelPath,
      contextId: options.contextId ?? 0,
    });
    this.contextId = result.contextId;
  }

  async unloadModel(contextId?: number): Promise<void> {
    await this.llama?.releaseContext({ contextId: contextId ?? this.contextId });
  }

  async complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string> {
    if (!this.llama) throw new Error("Model not loaded");
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n") + "\nassistant:";
    const result = await this.llama.completion({
      contextId: this.contextId,
      prompt,
      n_predict: options?.maxTokens ?? 512,
      temperature: options?.temperature ?? 0.7,
    });
    return result.text;
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
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
