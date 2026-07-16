/**
 * Study RAG reply helpers — extractive + LFM2 ChatML prompts (annadata studyChatReply).
 */

export const STUDY_CHAT_RAG_MAX_WORDS = 120;
export const STUDY_CHAT_RAG_MAX_SENTENCES = 5;
export const STUDY_CHAT_RAG_CLAMP = {
  maxWords: STUDY_CHAT_RAG_MAX_WORDS,
  maxSentences: STUDY_CHAT_RAG_MAX_SENTENCES,
} as const;
export const STUDY_CHAT_RAG_N_PREDICT = 160;

export const STUDY_CHAT_RAG_SYSTEM_RULES =
  "You are a study assistant. Use ONLY the given passages. " +
  "Copy the relevant sentence(s) verbatim from the passages — do not paraphrase or summarize. " +
  "Include enough surrounding context from the passage to answer the question (up to 4 sentences). " +
  "No lists, bullets, or headings. Do not prefix answers with passage numbers like [1].";

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

export function trimChatRepetition(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sentences) {
    const key = s.trim().toLowerCase().slice(0, 80);
    if (!key) continue;
    if (seen.has(key)) break;
    seen.add(key);
    out.push(s);
  }
  return out.join(" ").trim() || text.trim();
}

export function clampStudyChatReply(
  text: string,
  opts?: { maxSentences?: number; maxWords?: number },
): string {
  const maxSentences = opts?.maxSentences ?? STUDY_CHAT_RAG_MAX_SENTENCES;
  const maxWords = opts?.maxWords ?? STUDY_CHAT_RAG_MAX_WORDS;

  let t = text.trim().replace(/\s+/g, " ");
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
  const sentences = t.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  let out = sentences.slice(0, maxSentences).join(" ").trim();

  const words = out.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    out = words.slice(0, maxWords).join(" ");
    if (!/[.!?]$/.test(out)) out += ".";
  } else if (out && !/[.!?…]$/.test(out)) {
    const lastEnd = Math.max(out.lastIndexOf("."), out.lastIndexOf("!"), out.lastIndexOf("?"));
    out = lastEnd > 12 ? out.slice(0, lastEnd + 1) : `${out}…`;
  }

  return out.trim();
}

export function buildStudyContextFallbackReply(snippets: string[]): string {
  const best = snippets.find((s) => s.trim().length > 24);
  if (!best) return STUDY_CHAT_NO_CONTEXT_FALLBACK;
  const trimmed = best.trim().replace(/\s+/g, " ");
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  const quoted = sentences.slice(0, 4).join(" ").trim();
  return clampStudyChatReply(quoted || trimmed.slice(0, 280), STUDY_CHAT_RAG_CLAMP);
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

/** LFM2-1.2B-RAG ChatML prompt (Liquid HF recipe). */
export function buildStudyRagChatPrompt(userQuery: string, contextSnippets: string[]): string {
  const snippets = contextSnippets.filter(Boolean);
  const query = userQuery.slice(0, 200);
  const passageLimits = [400, 200, 150, 120, 100];
  const contextBlock = snippets
    .map((s, i) => `[${i + 1}] ${s.slice(0, passageLimits[i] ?? 80)}`)
    .join("\n");

  if (snippets.length === 0) {
    return (
      "<|startoftext|>" +
      `<|im_start|>system\n${STUDY_CHAT_NO_CONTEXT_RULES}\n` +
      "<|im_end|>\n" +
      `<|im_start|>user\n${query}\n` +
      "<|im_end|>\n" +
      "<|im_start|>assistant\n"
    );
  }

  const userBlock =
    `${STUDY_CHAT_RAG_SYSTEM_RULES}\n\n` +
    "Use the following passages to answer the question. " +
    "Copy relevant sentence(s) verbatim when possible.\n\n" +
    `${contextBlock}\n\n` +
    `Question: ${query}`;

  return (
    "<|startoftext|>" +
    `<|im_start|>user\n${userBlock}\n` +
    "<|im_end|>\n" +
    "<|im_start|>assistant\n"
  );
}
