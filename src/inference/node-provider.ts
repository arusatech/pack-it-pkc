import type {
  ChatMessage,
  CompletionOptions,
  GgufInferenceProvider,
  VisionRequest,
} from "./types.js";

type ChatSession = {
  prompt(text: string, options?: { maxTokens?: number }): Promise<string>;
};

/**
 * GGUF provider for Node.js and Electron desktop via node-llama-cpp.
 * Requires peer dependency: node-llama-cpp
 */
export class NodeGgufProvider implements GgufInferenceProvider {
  readonly platform = "node" as const;
  private session: ChatSession | null = null;
  private embeddingModel: {
    embed?: (text: string) => Promise<number[] | { embedding: number[] }>;
  } | null = null;

  static async create(): Promise<NodeGgufProvider> {
    return new NodeGgufProvider();
  }

  async loadModel(options: { modelPath: string; embedding?: boolean }): Promise<void> {
    const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: options.modelPath });

    if (options.embedding) {
      this.session = null;
      this.embeddingModel = model as typeof this.embeddingModel;
      return;
    }

    this.embeddingModel = null;
    const context = await model.createContext();
    this.session = new LlamaChatSession({
      contextSequence: context.getSequence(),
    });
  }

  async complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string> {
    if (!this.session) throw new Error("Model not loaded");
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n") + "\nassistant:";
    return this.session.prompt(prompt, { maxTokens: options?.maxTokens });
  }

  async embedText(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Text is required for embedding.");
    if (!this.embeddingModel) {
      throw new Error("No embedding model loaded. Call loadModel({ embedding: true }).");
    }
    const embedFn = (this.embeddingModel as { embed?: (t: string) => Promise<unknown> }).embed;
    if (typeof embedFn !== "function") {
      throw new Error("node-llama-cpp model does not expose embed() in this version.");
    }
    const result = await embedFn.call(this.embeddingModel, trimmed);
    if (Array.isArray(result)) return result as number[];
    if (result && typeof result === "object" && Array.isArray((result as { embedding?: number[] }).embedding)) {
      return (result as { embedding: number[] }).embedding;
    }
    throw new Error("Empty embedding from node-llama-cpp.");
  }

  async describeImage(request: VisionRequest): Promise<string | null> {
    if (!this.session) return null;
    const base64 = Buffer.from(request.bytes).toString("base64");
    return this.session.prompt(
      `${request.prompt}\n\n[Image: data:${request.mimeType};base64,${base64}]`,
      { maxTokens: 512 },
    );
  }

  async describeDocument(request: VisionRequest): Promise<string | null> {
    return this.describeImage(request);
  }
}
