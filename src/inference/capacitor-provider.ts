import type {
  ChatMessage,
  CompletionOptions,
  GgufInferenceProvider,
  VisionRequest,
} from "./types.js";

type LlamaContextLike = {
  completion: (params: {
    prompt: string;
    n_predict?: number;
    temperature?: number;
    stop?: string[];
  }) => Promise<{ text?: string; content?: string }>;
  embedding: (text: string) => Promise<{ embedding: number[] }>;
  release: () => Promise<void>;
};

type InitLlamaFn = (
  params: {
    model: string;
    embedding?: boolean;
    n_ctx?: number;
    n_gpu_layers?: number;
    n_batch?: number;
  },
  onProgress?: (progress: number) => void,
) => Promise<LlamaContextLike>;

type LlamaCppModule = {
  initLlama?: InitLlamaFn;
};

/**
 * GGUF provider for desktop / iOS / Android / PWA via llama-cpp-pro.
 * Uses the package high-level API: `initLlama({ model })` → LlamaContext.
 */
export class CapacitorGgufProvider implements GgufInferenceProvider {
  readonly platform = "capacitor" as const;
  private initLlama: InitLlamaFn | null = null;
  private context: LlamaContextLike | null = null;
  private modelPath = "";
  private embeddingMode = false;

  static async create(): Promise<CapacitorGgufProvider> {
    const provider = new CapacitorGgufProvider();
    let mod: LlamaCppModule;
    try {
      mod = (await import("llama-cpp-pro")) as LlamaCppModule;
    } catch (err) {
      throw new Error(
        `llama-cpp-pro is not installed. Add "llama-cpp-pro": "file:/Users/annadata/Project_A/llama-cpp-pro". (${String(err)})`,
      );
    }

    if (typeof mod.initLlama !== "function") {
      throw new Error(
        "llama-cpp-pro.initLlama is not a function. Build the local package (npm run build:llama) so dist/esm is present.",
      );
    }
    provider.initLlama = mod.initLlama;
    return provider;
  }

  async loadModel(options: {
    modelPath: string;
    contextId?: number;
    embedding?: boolean;
    onProgress?: (progress: number) => void;
  }): Promise<void> {
    if (!this.initLlama) {
      throw new Error("CapacitorGgufProvider not initialized. Call create() first.");
    }
    if (this.context) {
      try {
        await this.context.release();
      } catch {
        /* ignore */
      }
      this.context = null;
    }

    this.modelPath = options.modelPath;
    this.embeddingMode = options.embedding === true;
    this.context = await this.initLlama(
      {
        model: options.modelPath,
        embedding: this.embeddingMode,
        n_ctx: this.embeddingMode ? 512 : 2048,
        n_gpu_layers: 99,
        n_batch: this.embeddingMode ? 512 : 256,
      },
      options.onProgress
        ? (p) => {
            try {
              options.onProgress?.(p);
            } catch {
              /* ignore UI errors */
            }
          }
        : undefined,
    );
  }

  async unloadModel(_contextId?: number): Promise<void> {
    if (this.context) {
      await this.context.release();
      this.context = null;
    }
    this.embeddingMode = false;
  }

  async complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string> {
    if (!this.context) throw new Error("Model not loaded");
    if (this.embeddingMode) {
      throw new Error("Current model is loaded in embedding mode; load a chat model for complete().");
    }
    const prompt =
      options?.prompt?.trim() ||
      messages.map((m) => `${m.role}: ${m.content}`).join("\n") + "\nassistant:";
    const result = await this.context.completion({
      prompt,
      n_predict: options?.maxTokens ?? 512,
      temperature: options?.temperature ?? 0.7,
      stop: options?.stop,
    });
    return (result.text ?? result.content ?? "").trim();
  }

  async embedText(text: string): Promise<number[]> {
    if (!this.context) throw new Error("Model not loaded");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Text is required for embedding.");
    const result = await this.context.embedding(trimmed);
    if (!result?.embedding?.length) throw new Error("Empty embedding from runtime.");
    return result.embedding;
  }

  async describeImage(_request: VisionRequest): Promise<string | null> {
    return null;
  }

  async describeDocument(request: VisionRequest): Promise<string | null> {
    return this.describeImage(request);
  }
}
