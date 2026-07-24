/**
 * Load Study/plain PKC and answer questions (annadata PremodelService chat parity).
 */

import type { GgufInferenceProvider } from "../../inference/types.js";
import {
  ensureModelReady,
  getActiveModelId,
} from "../../inference/model-session.js";
import { unpackPkc, type PkcDocument } from "../pack.js";
import { unpackStudyPkc } from "../pack-study.js";
import { PKC_STUDY_VERSION, type PkcStudyDocument, type RagChunk } from "../study-types.js";
import { retrieveStudyContext } from "./retrieve.js";
import { resolveStudyChatImages, type StudyChatImage } from "./images.js";
import {
  STUDY_CHAT_NO_CONTEXT_FALLBACK,
  STUDY_CHAT_RAG_CLAMP,
  STUDY_CHAT_RAG_N_PREDICT,
  STUDY_CHAT_RAG_STOP,
  buildStudyRagChatPrompt,
  clampStudyChatReply,
  extractStudyReplyFromContext,
} from "./reply.js";
import { packSentencesIntoChunks, splitSentences } from "../study-chunk.js";
import {
  STUDY_RAG_TEMPERATURE,
  STUDY_RAG_TEMPERATURE_RETRY,
} from "../study-rag-config.js";
import { assessStudyRetrievalRelevance } from "./relevance.js";

function chunkMarkdown(markdown: string): RagChunk[] {
  const sentences = splitSentences(markdown);
  const units =
    sentences.length > 0
      ? packSentencesIntoChunks(sentences)
      : markdown.trim()
        ? packSentencesIntoChunks([markdown.trim()])
        : [];

  return units.map((text, idx) => ({
    chunkId: `md-${idx}`,
    blockId: `md-${idx}`,
    page: 1,
    kind: "text" as const,
    text,
    embedding: [],
  }));
}

function pkcDocumentToStudyDoc(doc: PkcDocument): PkcStudyDocument {
  const markdown = typeof doc.markdown === "string" ? doc.markdown : "";
  const chunks = chunkMarkdown(markdown);
  return {
    version: PKC_STUDY_VERSION,
    title: doc.title ?? null,
    source: doc.source ?? null,
    createdAt: doc.createdAt || new Date().toISOString(),
    markdown,
    blocks: [],
    chunks,
    flashCards: [],
    mcqs: [],
    games: [],
    models: { embedding: null, chat: null },
    stats: {
      blockCount: 0,
      chunkCount: chunks.length,
      embeddedChunkCount: 0,
      flashCardCount: 0,
      mcqCount: 0,
      gameCount: 0,
    },
    warnings: ["Loaded as plain PKC (markdown only) — no flash cards or MCQs."],
  };
}

/** Load Study PKC (v2) or plain markdown PKC (v1) for chat. */
export function loadPkcForChat(bytes: Uint8Array): PkcStudyDocument {
  try {
    const peeked = unpackPkc(bytes) as PkcDocument & { version?: number };
    const version = Number(peeked.version ?? 0);
    if (version === PKC_STUDY_VERSION) return unpackStudyPkc(bytes);
    if (typeof peeked.markdown === "string") return pkcDocumentToStudyDoc(peeked);
  } catch {
    /* fall through */
  }

  try {
    return unpackStudyPkc(bytes);
  } catch (err) {
    throw new Error(
      `Unsupported PKC file (expected v1 markdown or v2 Study PKC): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export interface AnswerStudyQuestionOptions {
  doc: PkcStudyDocument;
  query: string;
  provider: GgufInferenceProvider | null;
  chatModelId?: string | null;
  /** Load BGE and fuse vector hits (default true when embeddings exist). */
  useVectors?: boolean;
  onStatus?: (msg: string) => void;
}

export interface AnswerStudyQuestionResult {
  text: string;
  mode: "extractive" | "generative" | "fallback" | "no-context";
  retrievalMode: string;
  /** Diagrams from Study PKC image blocks related to retrieved passages. */
  images?: StudyChatImage[];
}

/**
 * Answer a question against a Study PKC document.
 * Extractive-first; generative only when retrieval is on-topic.
 * Off-topic queries return {@link STUDY_CHAT_NO_CONTEXT_FALLBACK} (no hallucination).
 */
export async function answerStudyQuestion(
  opts: AnswerStudyQuestionOptions,
): Promise<AnswerStudyQuestionResult> {
  const q = opts.query.trim();
  if (!q) {
    return { text: "", mode: "no-context", retrievalMode: "none" };
  }

  const {
    snippets,
    ranked,
    mode: retrievalMode,
    relevance,
  } = await retrieveStudyContext(opts.doc, q, {
    provider: opts.provider,
    useVectors: opts.useVectors,
    onStatus: opts.onStatus,
  });

  if (!snippets.length || retrievalMode === "no-match" || relevance?.relevant === false) {
    return {
      text: STUDY_CHAT_NO_CONTEXT_FALLBACK,
      mode: "no-context",
      retrievalMode: retrievalMode === "no-match" ? "no-match" : retrievalMode,
    };
  }

  const images = resolveStudyChatImages(opts.doc, ranked);
  const withImages = <T extends AnswerStudyQuestionResult>(result: T): T =>
    images.length ? { ...result, images } : result;

  const extractive = extractStudyReplyFromContext(q, snippets);
  if (extractive) {
    return withImages({ text: extractive, mode: "extractive", retrievalMode });
  }

  // No verbatim excerpt — only generate when retrieval is confidently on-topic.
  // Never dump unrelated passages (that caused electrochemistry "answers" for Pythagoras).
  const gate = relevance ?? assessStudyRetrievalRelevance(q, ranked);
  if (!gate.relevant) {
    return withImages({
      text: STUDY_CHAT_NO_CONTEXT_FALLBACK,
      mode: "no-context",
      retrievalMode: "no-match",
    });
  }

  if (!opts.provider) {
    return withImages({
      text: STUDY_CHAT_NO_CONTEXT_FALLBACK,
      mode: "no-context",
      retrievalMode,
    });
  }

  const chatModelId = opts.chatModelId || getActiveModelId();
  try {
    opts.onStatus?.("Loading chat model…");
    await ensureModelReady(opts.provider, chatModelId, {
      requireChatCapable: true,
      onStatus: opts.onStatus,
    });

    const prompt = buildStudyRagChatPrompt(q, snippets);
    let reply = await opts.provider.complete([], {
      prompt,
      maxTokens: STUDY_CHAT_RAG_N_PREDICT,
      temperature: STUDY_RAG_TEMPERATURE,
      stop: STUDY_CHAT_RAG_STOP,
    });

    let cleaned = clampStudyChatReply(reply, STUDY_CHAT_RAG_CLAMP);
    if (!cleaned) {
      reply = await opts.provider.complete([], {
        prompt,
        maxTokens: STUDY_CHAT_RAG_N_PREDICT,
        temperature: STUDY_RAG_TEMPERATURE_RETRY,
        stop: STUDY_CHAT_RAG_STOP,
      });
      cleaned = clampStudyChatReply(reply, STUDY_CHAT_RAG_CLAMP);
    }

    if (!cleaned) {
      return withImages({
        text: STUDY_CHAT_NO_CONTEXT_FALLBACK,
        mode: "no-context",
        retrievalMode,
      });
    }

    return withImages({ text: cleaned, mode: "generative", retrievalMode });
  } catch {
    return withImages({
      text: STUDY_CHAT_NO_CONTEXT_FALLBACK,
      mode: "no-context",
      retrievalMode,
    });
  }
}
