/**
 * Study RAG reply helpers — extractive + SmolLM2 ChatML prompts.
 */

import { polishStudyChatReply } from "./polish.js";
import {
  DEFAULT_STUDY_PIPELINE_CONFIG,
  STUDY_RAG_N_PREDICT,
} from "../study-rag-config.js";

export const STUDY_CHAT_RAG_MAX_WORDS = DEFAULT_STUDY_PIPELINE_CONFIG.maxReplyWords;
export const STUDY_CHAT_RAG_MAX_SENTENCES = DEFAULT_STUDY_PIPELINE_CONFIG.maxReplySentences;
export const STUDY_CHAT_RAG_CLAMP = {
  maxWords: STUDY_CHAT_RAG_MAX_WORDS,
  maxSentences: STUDY_CHAT_RAG_MAX_SENTENCES,
} as const;
export const STUDY_CHAT_RAG_N_PREDICT = STUDY_RAG_N_PREDICT;

export const STUDY_CHAT_RAG_SYSTEM_RULES =
  "You are a study assistant. Use ONLY the given passages. " +
  "If the passages do not contain the answer, reply with exactly: " +
  "I couldn't find information about that in the loaded study material. " +
  "Copy the relevant sentence(s) verbatim from the passages — do not paraphrase, invent, or use outside knowledge. " +
  "Include enough surrounding context from the passage to answer the question. " +
  "No lists, bullets, or headings. Do not prefix answers with passage numbers like [1]. " +
  "Keep normal spaces between English words. Write chemistry as one line, e.g. Zn(s) + Cu2+(aq) -> Zn2+(aq) + Cu(s).";

export const STUDY_CHAT_NO_CONTEXT_RULES =
  "You are a study assistant. No matching passages were found in the loaded study file for this question. " +
  "Reply in one short sentence saying you could not find that topic in the loaded material. " +
  "Do not invent facts or guess. No lists or headings.";

export const STUDY_CHAT_NO_CONTEXT_FALLBACK =
  "I couldn't find information about that in the loaded study material.";

export const STUDY_CHAT_RAG_STOP: string[] = [
  "<|im_end|>",
  "<|endoftext|>",
  "<|im_start|>",
  "<|startoftext|>",
];

export { polishStudyChatReply } from "./polish.js";
export {
  restoreMissingSpaces,
  joinBrokenIonCharges,
  stripPassagePrefix,
  dedupeAdjacentChemistryBlocks,
} from "./polish.js";

export function trimChatRepetition(text: string): string {
  const sentences = splitSentencesPreservingMath(text);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sentences) {
    const key = normalizeRepetitionKey(s);
    if (!key) continue;
    if (seen.has(key)) break;
    seen.add(key);
    out.push(s);
  }
  return out.join(" ").trim() || text.trim();
}

function normalizeRepetitionKey(sentence: string): string {
  return sentence
    .trim()
    .toLowerCase()
    .replace(/\$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

/** Sentence split that does not break on '.' inside $…$ / $$…$$. */
function splitSentencesPreservingMath(text: string): string[] {
  const chunks = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g);
  const sentences: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t) sentences.push(t);
    buf = "";
  };

  for (const chunk of chunks) {
    if (!chunk) continue;
    if (
      (chunk.startsWith("$$") && chunk.endsWith("$$")) ||
      (chunk.startsWith("$") && chunk.endsWith("$") && chunk.length >= 2)
    ) {
      buf += chunk;
      continue;
    }
    let i = 0;
    while (i < chunk.length) {
      const rest = chunk.slice(i);
      const m = rest.match(/^[\s\S]*?[.!?](?=\s|$)/);
      if (m && m[0]) {
        buf += m[0];
        flush();
        i += m[0].length;
        while (chunk[i] === " ") i++;
      } else {
        buf += rest;
        break;
      }
    }
  }
  flush();
  return sentences;
}

/**
 * Split into tokens for word-count clamping, keeping $…$ / $$…$$ spans atomic
 * so we never cut through \\ce{Zn(s) + …}.
 */
function tokenizePreservingMath(text: string): string[] {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g).filter((p) => p.length > 0);
  const tokens: string[] = [];
  for (const part of parts) {
    if (
      (part.startsWith("$$") && part.endsWith("$$")) ||
      (part.startsWith("$") && part.endsWith("$") && part.length >= 2)
    ) {
      tokens.push(part);
      continue;
    }
    for (const w of part.split(/\s+/)) {
      if (w) tokens.push(w);
    }
  }
  return tokens;
}

/** Drop truncated math left by model/clamp (e.g. "$\\ce{Zn(s) +" with no closing). */
export function dropIncompleteMath(text: string): string {
  let s = text.trim();
  if (!s) return s;

  // Odd number of $ → cut from the last opener
  if (((s.match(/\$/g) || []).length & 1) === 1) {
    s = s.slice(0, s.lastIndexOf("$")).trimEnd();
  }

  // Broken \\ce{ / \\pu{ without closing brace (with or without $)
  s = s.replace(/\$?\\(?:ce|pu)\{(?:[^{}]|\{[^}]*\})*$/g, "").trimEnd();

  // Orphan opener left at end: "$\\ce{Zn(s) +"
  s = s.replace(/\$\\(?:ce|pu)\{[^$]*$/g, "").trimEnd();

  // Trailing dangling reaction ops outside math
  s = s.replace(/\s*(?:\+|<-|->|<->)\s*$/g, "").trimEnd();

  return s.replace(/[ \t]+/g, " ").trim();
}

export function clampStudyChatReply(
  text: string,
  opts?: { maxSentences?: number; maxWords?: number },
): string {
  const maxSentences = opts?.maxSentences ?? STUDY_CHAT_RAG_MAX_SENTENCES;
  const maxWords = opts?.maxWords ?? STUDY_CHAT_RAG_MAX_WORDS;

  let t = polishStudyChatReply(text);
  for (const re of [
    /\n\s*\n/,
    /\n\s*(?:\d+[.)]|[-*•])\s/,
    /\n(?:Common|Symptoms|Treatment|Causes)\b/i,
  ]) {
    const idx = t.search(re);
    if (idx > 12) {
      t = t.slice(0, idx).trim();
      break;
    }
  }

  t = trimChatRepetition(t);
  let out = splitSentencesPreservingMath(t).slice(0, maxSentences).join(" ").trim();

  const tokens = tokenizePreservingMath(out);
  if (tokens.length > maxWords) {
    out = tokens.slice(0, maxWords).join(" ");
    // Never end on a half-open math token (atomic tokens shouldn't, but be safe)
    out = dropIncompleteMath(out);
    if (!/[.!?…]$/.test(out) && !/\$$/.test(out)) {
      const lastEnd = Math.max(out.lastIndexOf("."), out.lastIndexOf("!"), out.lastIndexOf("?"));
      out = lastEnd > 12 ? out.slice(0, lastEnd + 1) : `${out}…`;
    }
  } else if (out && !/[.!?…]$/.test(out) && !/\$$/.test(out)) {
    const lastEnd = Math.max(out.lastIndexOf("."), out.lastIndexOf("!"), out.lastIndexOf("?"));
    out = lastEnd > 12 ? out.slice(0, lastEnd + 1) : `${out}…`;
  }

  return dropIncompleteMath(out);
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

function queryTerms(userQuery: string): string[] {
  return userQuery
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
}

/** Prefer verbatim cartridge text when retrieved passages contain query terms. */
export function extractStudyReplyFromContext(
  userQuery: string,
  snippets: string[],
): string | null {
  const terms = queryTerms(userQuery);
  if (terms.length === 0 || snippets.length === 0) return null;

  for (const snippet of snippets) {
    const text = snippet.trim().replace(/\s+/g, " ");
    if (!text) continue;

    const normalized = normalizeForMatch(text);
    const matchedTerms = terms.filter((t) => normalized.includes(t));
    if (matchedTerms.length === 0) continue;

    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const firstMatchIdx = sentences.findIndex((s) =>
      terms.some((t) => normalizeForMatch(s).includes(t)),
    );

    if (firstMatchIdx >= 0) {
      const excerpt = sentences.slice(firstMatchIdx, firstMatchIdx + 4).join(" ").trim();
      if (excerpt.length > 20) {
        return clampStudyChatReply(excerpt, STUDY_CHAT_RAG_CLAMP);
      }
    }

    const anchor = matchedTerms[0]!;
    const idx = normalized.indexOf(anchor);
    if (idx >= 0) {
      const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, idx - 60)));
      const end = Math.min(text.length, idx + 320);
      const excerpt = text.slice(start, end).trim();
      if (excerpt.length > 20) {
        return clampStudyChatReply(excerpt, STUDY_CHAT_RAG_CLAMP);
      }
    }
  }

  return null;
}

/** SmolLM2-Instruct ChatML prompt (Hugging Face chat_template). */
export function buildStudyRagChatPrompt(userQuery: string, contextSnippets: string[]): string {
  const snippets = contextSnippets.filter(Boolean);
  const query = userQuery.slice(0, 200);
  // Fewer, fuller passages — fuse Top_K is 3; leave room for Smol n_ctx.
  const passageLimits = [900, 700, 500];
  const contextBlock = snippets
    .map((s, i) => `[${i + 1}] ${s.slice(0, passageLimits[i] ?? 400)}`)
    .join("\n");

  if (snippets.length === 0) {
    return (
      `<|im_start|>system\n${STUDY_CHAT_NO_CONTEXT_RULES}<|im_end|>\n` +
      `<|im_start|>user\n${query}<|im_end|>\n` +
      `<|im_start|>assistant\n`
    );
  }

  const userBlock =
    "Use the following passages to answer the question. " +
    "Copy relevant sentence(s) verbatim when possible.\n\n" +
    `${contextBlock}\n\n` +
    `Question: ${query}`;

  return (
    `<|im_start|>system\n${STUDY_CHAT_RAG_SYSTEM_RULES}<|im_end|>\n` +
    `<|im_start|>user\n${userBlock}<|im_end|>\n` +
    `<|im_start|>assistant\n`
  );
}

export function buildStudyContextFallbackReply(snippets: string[]): string {
  const best = snippets.find((s) => s.trim().length > 24);
  if (!best) return STUDY_CHAT_NO_CONTEXT_FALLBACK;
  const trimmed = best.trim().replace(/\s+/g, " ");
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  const quoted = sentences.slice(0, 4).join(" ").trim();
  return clampStudyChatReply(quoted || trimmed.slice(0, 280), STUDY_CHAT_RAG_CLAMP);
}
