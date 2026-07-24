import type { GgufInferenceProvider } from "../inference/types.js";
import {
  DEFAULT_OFFLINE_MODEL_ID,
  SMOL_CHAT_MODEL_ID,
} from "../inference/model-catalog.js";
import { ensureEmbeddingModelReady, ensureModelReady, getActiveModelId, getLoadedModelId } from "../inference/model-session.js";
import { explainModelFailure } from "../inference/model-errors.js";
import type { PdfDocumentBlocks } from "../pdf/pdf-block-types.js";
import { packStudyPkc } from "./pack-study.js";
import { generateFlashCards, generateMcqsFromFlashCards } from "./study-cards.js";
import { chunkStudyBlocks } from "./study-chunk.js";
import { blocksToStudyDocumentParts } from "./study-from-blocks.js";
import {
  PKC_STUDY_VERSION,
  type PkcStudyDocument,
  type PkcStudyStats,
} from "./study-types.js";
import { createStudyVectorIndex } from "./vector/create-index.js";
import type { StudyVectorBackend } from "./vector/types.js";

export type GenerateStudyPkcOptions = {
  title?: string | null;
  source?: string | null;
  llmProvider?: GgufInferenceProvider | null;
  embeddingProvider?: GgufInferenceProvider | null;
  chatModelId?: string;
  embeddingModelId?: string;
  onProgress?: (message: string) => void;
  generateFlashMcq?: boolean;
  generateEmbeddings?: boolean;
  /**
   * When true (default), download/load Smol for LLM flash answers after embeddings.
   * Set false to finish faster with rule-based flashcards only.
   */
  loadChatModelIfNeeded?: boolean;
  /** Max ms to wait for chat model load when loadChatModelIfNeeded (default 120s). */
  chatModelLoadTimeoutMs?: number;
  /** Max ms to wait for embedding model load (default 180s). */
  embeddingModelLoadTimeoutMs?: number;
};

export type GenerateStudyPkcResult = {
  document: PkcStudyDocument;
  pkc: Uint8Array;
  warnings: string[];
};

function buildStats(doc: Omit<PkcStudyDocument, "stats">): PkcStudyStats {
  return {
    blockCount: doc.blocks.length,
    chunkCount: doc.chunks.length,
    embeddedChunkCount: doc.chunks.filter((c) => c.embedding.length > 0).length,
    flashCardCount: doc.flashCards.length,
    mcqCount: doc.mcqs.length,
    gameCount: doc.games.length,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

/**
 * Build a self-contained study PKC (blocks + RAG chunks/embeddings + flash + MCQ).
 * Always returns a valid document; missing models produce warnings and empty vectors/cards as needed.
 */
export async function generateStudyPkc(
  pdfBlocks: PdfDocumentBlocks,
  options: GenerateStudyPkcOptions = {},
): Promise<GenerateStudyPkcResult> {
  const warnings: string[] = [];
  const onProgress = options.onProgress;
  const wantFlash = options.generateFlashMcq !== false;
  const chatModelId = options.chatModelId ?? getActiveModelId() ?? SMOL_CHAT_MODEL_ID;
  const embeddingModelId = options.embeddingModelId ?? DEFAULT_OFFLINE_MODEL_ID;
  const llm = options.llmProvider ?? null;
  const embedProvider = options.embeddingProvider ?? llm;
  const loadChatIfNeeded = options.loadChatModelIfNeeded !== false;
  const chatLoadTimeout = options.chatModelLoadTimeoutMs ?? 120_000;
  // BGE is ~17 MB; 60s is enough when loading from cache via LlamaService.
  const embedLoadTimeout = options.embeddingModelLoadTimeoutMs ?? 60_000;

  onProgress?.("Mapping blocks…");
  const { blocks, markdown } = blocksToStudyDocumentParts(pdfBlocks);

  onProgress?.("Chunking for RAG…");
  const chunks = chunkStudyBlocks(blocks);

  const wantEmbed =
    options.generateEmbeddings !== false &&
    chunks.length > 0 &&
    typeof embedProvider?.embedText === "function";

  let usedEmbeddingModel: string | null = null;
  let usedVectorBackend: StudyVectorBackend | null = null;
  if (wantEmbed && embedProvider) {
    try {
      onProgress?.(`Loading embedding model ${embeddingModelId}…`);
      await withTimeout(
        ensureEmbeddingModelReady(embedProvider, embeddingModelId, {
          onStatus: onProgress,
        }),
        embedLoadTimeout,
        `Embedding model ${embeddingModelId}`,
      );
      usedEmbeddingModel = embeddingModelId;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        onProgress?.(`Embedding ${i + 1}/${chunks.length}…`);
        try {
          chunk.embedding = await embedProvider.embedText!(chunk.text);
        } catch (err) {
          warnings.push(
            `Embedding failed for ${chunk.chunkId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          chunk.embedding = [];
        }
      }

      const embedded = chunks.filter((c) => c.embedding.length > 0);
      if (embedded.length > 0) {
        onProgress?.("Building USearch vector index…");
        const dim = embedded[0]!.embedding.length;
        const index = await createStudyVectorIndex(dim);
        index.add(
          embedded.map((c) => ({
            chunkId: c.chunkId,
            text: c.text,
            embedding: c.embedding,
          })),
        );
        usedVectorBackend = index.backend;
        onProgress?.(
          `Vector index ready (${index.backend}, ${index.size()} vectors)`,
        );
      }
    } catch (err) {
      const msg = explainModelFailure(embeddingModelId, err, /timed out/i.test(String(err)) ? "timeout" : "load");
      onProgress?.(msg);
      warnings.push(`Embeddings skipped: ${msg}`);
    }
  } else if (options.generateEmbeddings !== false && chunks.length > 0) {
    warnings.push("Embeddings skipped: provider has no embedText() (download BGE and use an embed-capable provider).");
  }

  let flashCards = [] as Awaited<ReturnType<typeof generateFlashCards>>;
  let mcqs = [] as ReturnType<typeof generateMcqsFromFlashCards>;
  let usedChatModel: string | null = null;

  if (wantFlash) {
    let chatProvider: GgufInferenceProvider | null = null;
    const chatAlreadyLoaded = !!llm && getLoadedModelId() === chatModelId;

    if (llm && chatAlreadyLoaded) {
      chatProvider = llm;
      usedChatModel = chatModelId;
      onProgress?.(`Using loaded chat model ${chatModelId} for flash answers…`);
    } else if (llm && loadChatIfNeeded) {
      try {
        onProgress?.(
          `Loading chat model ${chatModelId} (~100 MB). Needs free disk to download and free RAM to load…`,
        );
        await withTimeout(
          ensureModelReady(llm, chatModelId, { onStatus: onProgress }),
          chatLoadTimeout,
          `Chat model ${chatModelId}`,
        );
        usedChatModel = chatModelId;
        chatProvider = llm;
      } catch (err) {
        const msg = explainModelFailure(
          chatModelId,
          err,
          /timed out/i.test(String(err)) ? "timeout" : "load",
        );
        onProgress?.(msg);
        warnings.push(`Chat model unavailable — using rule-based flash answers only. ${msg}`);
        chatProvider = null;
      }
    } else {
      const skipMsg = explainModelFailure(chatModelId, "skipped for speed", "skip");
      onProgress?.(skipMsg);
      if (llm) {
        warnings.push(skipMsg);
      } else {
        warnings.push(
          "No LLM provider — flashcards use rule-based answers only; MCQs still generated from flash peers.",
        );
      }
    }

    onProgress?.("Generating flashcards…");
    flashCards = await generateFlashCards(blocks, chatProvider, onProgress);
    onProgress?.("Building MCQs from flashcards…");
    mcqs = generateMcqsFromFlashCards(flashCards);
  }

  const draft: Omit<PkcStudyDocument, "stats"> = {
    version: PKC_STUDY_VERSION,
    title: options.title ?? pdfBlocks.title ?? null,
    source: options.source ?? null,
    createdAt: new Date().toISOString(),
    markdown,
    blocks,
    chunks,
    flashCards,
    mcqs,
    games: [],
    models: {
      embedding: usedEmbeddingModel,
      chat: usedChatModel,
      vectorIndex: usedVectorBackend,
    },
    warnings: warnings.length ? warnings : undefined,
  };

  const document: PkcStudyDocument = {
    ...draft,
    stats: buildStats(draft),
  };

  onProgress?.("Packing study PKC…");
  const pkc = packStudyPkc(document);
  onProgress?.(
    `Study PKC ready · ${document.stats.blockCount} blocks · ${document.stats.chunkCount} chunks · ${document.stats.flashCardCount} flash · ${document.stats.mcqCount} MCQ`,
  );

  return { document, pkc, warnings };
}
