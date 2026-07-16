import type { GgufInferenceProvider } from "../inference/types.js";
import {
  DEFAULT_OFFLINE_MODEL_ID,
  LFM2_CHAT_MODEL_ID,
} from "../inference/model-catalog.js";
import { ensureEmbeddingModelReady, ensureModelReady, getActiveModelId } from "../inference/model-session.js";
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
  const chatModelId = options.chatModelId ?? getActiveModelId() ?? LFM2_CHAT_MODEL_ID;
  const embeddingModelId = options.embeddingModelId ?? DEFAULT_OFFLINE_MODEL_ID;
  const llm = options.llmProvider ?? null;
  const embedProvider = options.embeddingProvider ?? llm;

  onProgress?.("Mapping blocks…");
  const { blocks, markdown } = blocksToStudyDocumentParts(pdfBlocks);

  onProgress?.("Chunking for RAG…");
  const chunks = chunkStudyBlocks(blocks);

  const wantEmbed =
    options.generateEmbeddings !== false &&
    chunks.length > 0 &&
    typeof embedProvider?.embedText === "function";

  let usedEmbeddingModel: string | null = null;
  if (wantEmbed && embedProvider) {
    try {
      onProgress?.(`Loading embedding model ${embeddingModelId}…`);
      await ensureEmbeddingModelReady(embedProvider, embeddingModelId, {
        onStatus: onProgress,
      });
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
    } catch (err) {
      warnings.push(
        `Embeddings skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (options.generateEmbeddings !== false && chunks.length > 0) {
    warnings.push("Embeddings skipped: provider has no embedText() (download BGE and use an embed-capable provider).");
  }

  let flashCards = [] as Awaited<ReturnType<typeof generateFlashCards>>;
  let mcqs = [] as ReturnType<typeof generateMcqsFromFlashCards>;
  let usedChatModel: string | null = null;

  if (wantFlash) {
    let chatProvider = llm;
    if (llm) {
      try {
        onProgress?.(`Loading chat model ${chatModelId} for flash/MCQ…`);
        await ensureModelReady(llm, chatModelId, { onStatus: onProgress });
        usedChatModel = chatModelId;
        chatProvider = llm;
      } catch (err) {
        warnings.push(
          `Chat model unavailable — using rule-based flash answers only: ${err instanceof Error ? err.message : String(err)}`,
        );
        chatProvider = null;
      }
    } else {
      warnings.push("No LLM provider — flashcards use rule-based answers only; MCQs still generated from flash peers.");
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
