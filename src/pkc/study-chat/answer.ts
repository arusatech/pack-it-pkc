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
import {
  STUDY_CHAT_NO_CONTEXT_FALLBACK,
  STUDY_CHAT_RAG_CLAMP,
  STUDY_CHAT_RAG_N_PREDICT,
  STUDY_CHAT_RAG_STOP,
  buildStudyContextFallbackReply,
  buildStudyRagChatPrompt,
  clampStudyChatReply,
  extractStudyReplyFromContext,
} from "./reply.js";

function chunkMarkdown(markdown: string): RagChunk[] {
  const parts = markdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: RagChunk[] = [];
  let buf = "";
  let idx = 0;

  const flush = () => {
    const text = buf.trim();
    if (!text) return;
    chunks.push({
      chunkId: `md-${idx}`,
      blockId: `md-${idx}`,
      page: 1,
      kind: "text",
      text,
      embedding: [],
    });
    idx += 1;
    buf = "";
  };

  for (const part of parts) {
    if (buf.length === 0) buf = part;
    else if (buf.length + part.length + 2 < 900) buf = `${buf}\n\n${part}`;
    else {
      flush();
      buf = part;
    }
  }
  flush();
  return chunks;
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
    models: { embedding: null, chat: null },
    stats: {
      blockCount: 0,
      chunkCount: chunks.length,
      embeddedChunkCount: 0,
      flashCardCount: 0,
      mcqCount: 0,
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
}

/**
 * Answer a question against a Study PKC document.
 * Extractive-first, then LFM2 ChatML RAG completion (annadata path).
 */
export async function answerStudyQuestion(
  opts: AnswerStudyQuestionOptions,
): Promise<AnswerStudyQuestionResult> {
  const q = opts.query.trim();
  if (!q) {
    return { text: "", mode: "no-context", retrievalMode: "none" };
  }

  const { snippets, mode: retrievalMode } = await retrieveStudyContext(opts.doc, q, {
    provider: opts.provider,
    useVectors: opts.useVectors,
    onStatus: opts.onStatus,
  });

  if (!snippets.length) {
    return {
      text: STUDY_CHAT_NO_CONTEXT_FALLBACK,
      mode: "no-context",
      retrievalMode,
    };
  }

  const extractive = extractStudyReplyFromContext(q, snippets);
  if (extractive) {
    return { text: extractive, mode: "extractive", retrievalMode };
  }

  if (!opts.provider) {
    return {
      text: buildStudyContextFallbackReply(snippets),
      mode: "fallback",
      retrievalMode,
    };
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
      temperature: 0,
      stop: STUDY_CHAT_RAG_STOP,
    });

    let cleaned = clampStudyChatReply(reply, STUDY_CHAT_RAG_CLAMP);
    if (!cleaned) {
      reply = await opts.provider.complete([], {
        prompt,
        maxTokens: STUDY_CHAT_RAG_N_PREDICT,
        temperature: 0.15,
        stop: STUDY_CHAT_RAG_STOP,
      });
      cleaned = clampStudyChatReply(reply, STUDY_CHAT_RAG_CLAMP);
    }

    if (!cleaned) {
      return {
        text: buildStudyContextFallbackReply(snippets),
        mode: "fallback",
        retrievalMode,
      };
    }

    return { text: cleaned, mode: "generative", retrievalMode };
  } catch {
    return {
      text: buildStudyContextFallbackReply(snippets),
      mode: "fallback",
      retrievalMode,
    };
  }
}
