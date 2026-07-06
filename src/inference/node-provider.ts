import type {
  ChatMessage,
  CompletionOptions,
  GgufInferenceProvider,
  VisionRequest,
} from "./types.js";

/**
 * GGUF provider for Node.js and Electron desktop via node-llama-cpp.
 * Requires peer dependency: node-llama-cpp
 */
export class NodeGgufProvider implements GgufInferenceProvider {
  readonly platform = "node" as const;
  private context: {
    completion: (opts: { messages: Array<{ role: string; content: string }> }) => Promise<string>;
  } | null = null;

  static async create(): Promise<NodeGgufProvider> {
    return new NodeGgufProvider();
  }

  async loadModel(options: { modelPath: string }): Promise<void> {
    const { getLlama } = await import("node-llama-cpp");
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: options.modelPath });
    this.context = await model.createContext();
  }

  async complete(messages: ChatMessage[], _options?: CompletionOptions): Promise<string> {
    if (!this.context) throw new Error("Model not loaded");
    return this.context.completion({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
  }

  async describeImage(request: VisionRequest): Promise<string | null> {
    if (!this.context) return null;
    const base64 = Buffer.from(request.bytes).toString("base64");
    return this.context.completion({
      messages: [
        {
          role: "user",
          content: `${request.prompt}\n[data:${request.mimeType};base64,${base64}]`,
        },
      ],
    });
  }

  async describeDocument(request: VisionRequest): Promise<string | null> {
    return this.describeImage(request);
  }
}
