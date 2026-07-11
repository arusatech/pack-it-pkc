import type { GgufInferenceProvider } from "../inference/types.js";
import { splitSentences } from "./study-chunk.js";
import type { FlashCard, Mcq, StudyBlock } from "./study-types.js";

export type StudyCardProgress = (message: string) => void;

function trimAnswer(text: string, maxWords = 14): string {
  const words = text.replaceAll(/\s+/g, " ").trim().split(" ");
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function isMetaAnswer(text: string): boolean {
  return /^(i (don't|do not)|as an ai|cannot determine|not (enough|sufficient)|n\/a)/i.test(text.trim());
}

function deriveQuestion(sentence: string): string {
  const s = sentence.trim();
  if (/\?$/.test(s)) return s;

  const def = s.match(/^(.{3,80}?)\s+(?:is|are|was|were|means|refers to)\s+(.+)$/i);
  if (def) return `What is ${def[1]!.trim()}?`;

  const called = s.match(/\b(?:called|known as)\s+([A-Z][\w\s-]{2,40})/i);
  if (called) return `What is ${called[1]!.trim()}?`;

  const short = s.length > 110 ? `${s.slice(0, 107)}…` : s;
  return `What does this state: ${short}`;
}

function resolveDirectAnswer(sentence: string, question: string): string | null {
  const def = sentence.match(/\b(?:is|are|was|were|means|refers to)\s+(.+?)(?:\.|$)/i);
  if (def?.[1] && def[1].trim().length >= 3) return trimAnswer(def[1]);
  if (question.startsWith("What does this state:")) return trimAnswer(sentence);
  return null;
}

async function answerWithLlm(
  provider: GgufInferenceProvider | null | undefined,
  context: string,
  question: string,
): Promise<string | null> {
  if (!provider) return null;
  try {
    const text = await provider.complete(
      [
        {
          role: "system",
          content:
            "Copy a short answer phrase (max 12 words) from the context ONLY. No meta commentary.",
        },
        {
          role: "user",
          content: `Context:\n${context.slice(0, 900)}\n\nQuestion: ${question}\n\nShort phrase from context:`,
        },
      ],
      { maxTokens: 48, temperature: 0.05 },
    );
    const raw = trimAnswer(text.replaceAll(/^["']|["']$/g, "").trim());
    if (!raw || isMetaAnswer(raw) || raw.length < 2) return null;
    return raw;
  } catch {
    return null;
  }
}

function normaliseKey(s: string): string {
  return s.toLowerCase().replaceAll(/\s+/g, " ").trim().slice(0, 96);
}

/** Build flashcards from study blocks (rule-based + optional LLM answers). */
export async function generateFlashCards(
  blocks: StudyBlock[],
  provider?: GgufInferenceProvider | null,
  onProgress?: StudyCardProgress,
): Promise<FlashCard[]> {
  const cards: FlashCard[] = [];
  const seen = new Set<string>();
  let n = 0;

  for (const block of blocks) {
    if (block.kind === "image") continue;

    if (block.kind === "qa") {
      const q = (block.question ?? "").trim();
      const a = (block.answer ?? "").trim();
      if (q && a) {
        const key = normaliseKey(q);
        if (!seen.has(key)) {
          seen.add(key);
          cards.push({
            id: `fc-${block.id}-${n++}`,
            blockId: block.id,
            page: block.page,
            info: q,
            solution: { text: trimAnswer(a, 40) },
          });
        }
      }
      continue;
    }

    if (block.kind === "formula" || block.kind === "math") {
      const content = block.content.trim();
      if (content.length < 3) continue;
      const info = block.title?.trim()
        ? `Write the expression for: ${block.title.trim()}`
        : `Reproduce this ${block.kind}:`;
      const key = normaliseKey(info + content);
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push({
        id: `fc-${block.id}-${n++}`,
        blockId: block.id,
        page: block.page,
        info,
        solution: { text: content },
      });
      continue;
    }

    const sentences = splitSentences(block.content);
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]!;
      onProgress?.(`Flash ${cards.length + 1} · ${block.id}`);
      const question = deriveQuestion(sentence);
      const key = normaliseKey(question);
      if (seen.has(key)) continue;

      let answer = resolveDirectAnswer(sentence, question);
      if (!answer) {
        const window = sentences.slice(Math.max(0, i - 1), i + 2).join(" ");
        answer = (await answerWithLlm(provider, window, question)) ?? trimAnswer(sentence);
      }
      if (isMetaAnswer(answer) || answer.length < 2) answer = trimAnswer(sentence);

      seen.add(key);
      cards.push({
        id: `fc-${block.id}-${n++}`,
        blockId: block.id,
        page: block.page,
        info: question,
        solution: { text: answer },
      });
    }
  }

  return cards;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Build 4-option MCQs from flashcards; prefer same-page distractors. */
export function generateMcqsFromFlashCards(flashCards: FlashCard[]): Mcq[] {
  if (flashCards.length < 4) return [];

  const byPage = new Map<number, FlashCard[]>();
  for (const fc of flashCards) {
    const list = byPage.get(fc.page) ?? [];
    list.push(fc);
    byPage.set(fc.page, list);
  }

  const mcqs: Mcq[] = [];
  let n = 0;

  for (const card of flashCards) {
    const correct = card.solution.text.trim();
    if (correct.length < 2) continue;

    const samePage = (byPage.get(card.page) ?? []).filter((c) => c.id !== card.id);
    const others = flashCards.filter((c) => c.id !== card.id);
    const pool = [...samePage, ...others.filter((c) => !samePage.includes(c))];

    const distractors: string[] = [];
    const used = new Set([normaliseKey(correct)]);
    for (const peer of pool) {
      const t = peer.solution.text.trim();
      const k = normaliseKey(t);
      if (!t || used.has(k)) continue;
      used.add(k);
      distractors.push(t);
      if (distractors.length >= 3) break;
    }
    if (distractors.length < 3) continue;

    const options = shuffleInPlace([correct, distractors[0]!, distractors[1]!, distractors[2]!]) as [
      string,
      string,
      string,
      string,
    ];
    const answerIndex = options.indexOf(correct) as 0 | 1 | 2 | 3;

    mcqs.push({
      id: `mcq-${card.blockId}-${n++}`,
      blockId: card.blockId,
      page: card.page,
      question: card.info,
      options,
      answerIndex,
      explanation: correct,
    });
  }

  return mcqs;
}
