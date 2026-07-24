import type { GgufInferenceProvider } from "../inference/types.js";
import { splitSentences } from "./study-chunk.js";
import type { FlashCard, Mcq, StudyBlock } from "./study-types.js";

export type StudyCardProgress = (message: string) => void;

const DEPENDENT_START =
  /^(?:and|or|but|so|yet|nor|for|however|therefore|thus|hence|conversely|similarly|likewise|moreover|furthermore|additionally|also|then|next|which|that|who|whom|whose|where|when|while|whereas|although|though|because|since|if|unless|until|as|than|of|in|on|to|by|with|from|into|onto|upon|via|per|versus|vs\.?)\b/i;

const TRAILING_INCOMPLETE =
  /(?:,|;|:|\band\b|\bor\b|\bbut\b|\bsuch as\b|\be\.g\.?\b|\bi\.e\.?\b|\bversus\b|\bvs\.?\b|\bincluding\b|\bnamely\b)\s*$/i;

const CONNECTOR_JOIN =
  /\b(?:conversely|however|therefore|thus|hence|moreover|furthermore|additionally|whereas|while)\b/i;

function trimAnswer(text: string, maxWords = 40): string {
  const cleaned = text.replaceAll(/\s+/g, " ").trim();
  // Keep chemistry / math markup intact — word-trim would chop \\ce{…}.
  if (/\\ce\{|\\pu\{|\$/.test(cleaned) && cleaned.length <= 320) return cleaned;
  const words = cleaned.split(" ");
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function isMetaAnswer(text: string): boolean {
  return /^(i (don't|do not)|as an ai|cannot determine|not (enough|sufficient)|n\/a)/i.test(text.trim());
}

function endsWithTerminal(s: string): boolean {
  return /[.!?]["')\]]*$/.test(s.trim());
}

function looksIncomplete(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return true;
  if (!endsWithTerminal(s) && s.length < 180) return true;
  if (TRAILING_INCOMPLETE.test(s)) return true;
  // Hard-split leftovers often end mid-word with ellipsis or no period.
  if (s.endsWith("…") || s.endsWith("...")) return true;
  return false;
}

function looksDependentOnPrevious(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return true;
  if (DEPENDENT_START.test(s)) return true;
  // Continuations often start lowercase after a bad split.
  if (/^[a-z]/.test(s)) return true;
  return false;
}

/**
 * Merge period-split sentences that are incomplete or depend on neighbors
 * into self-contained study units suitable for flash / MCQ.
 */
export function buildFlashCardUnits(sentences: string[]): string[] {
  const units: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.replaceAll(/\s+/g, " ").trim();
    buf = "";
    if (!t) return;
    if (t.length < 28) return;
    // Prefer units that end with a real sentence terminator.
    if (!endsWithTerminal(t) && t.split(/\s+/).length < 8) return;
    units.push(endsWithTerminal(t) ? t : `${t}.`);
  };

  for (const raw of sentences) {
    const s = raw.replaceAll(/\s+/g, " ").trim();
    if (!s) continue;

    if (!buf) {
      buf = s;
      continue;
    }

    const shouldMerge =
      looksIncomplete(buf) ||
      looksDependentOnPrevious(s) ||
      CONNECTOR_JOIN.test(s) ||
      // Keep short factual pair together when next clause continues the idea.
      (!endsWithTerminal(buf) && s.length > 0);

    if (shouldMerge) {
      // Soften a finished sentence when attaching a dependent continuation
      // ("…. Conversely," → "…, conversely,") so the merged unit reads as one statement.
      let left = buf;
      let joiner = " ";
      if (/[.!?]$/.test(left) && looksDependentOnPrevious(s)) {
        left = left.replace(/[.!?]+$/, "");
        joiner = ", ";
      } else if (/[,;:]$/.test(left)) {
        joiner = " ";
      }
      buf = `${left}${joiner}${s}`.replaceAll(/\s+/g, " ").trim();
      if (endsWithTerminal(buf) && !TRAILING_INCOMPLETE.test(buf) && buf.length >= 40) {
        flush();
      }
      continue;
    }

    flush();
    buf = s;
  }
  flush();
  return units;
}

function clozeNounPhrase(unit: string): { question: string; answer: string } | null {
  // Prefer multi-word scientific / proper phrases, then solid single nouns.
  const multi =
    unit.match(
      /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){1,4})\b/,
    ) ??
    unit.match(
      /\b((?:chemical reactions?|electrical energy|copper sulfate|galvanic cells?|redox reactions?|electrolytic cells?|aqueous solutions?)[a-z]*)\b/i,
    );
  const single = unit.match(
    /\b((?:electrochemistry|electrolysis|oxidation|reduction|anode|cathode|electrode|electrolyte|voltage|current|ions?)\w*)\b/i,
  );
  const phrase = (multi?.[1] ?? single?.[1] ?? "").trim();
  if (!phrase || phrase.length < 4) return null;
  if (phrase.split(/\s+/).length > 6) return null;

  const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (!re.test(unit)) return null;
  const question = `${unit.replace(re, "______").replace(/\s+/g, " ").trim()}`;
  if (!question.includes("______")) return null;
  if (question.length < 24) return null;
  return { question: question.endsWith("?") ? question : `${question.replace(/[.!?]+$/, "")}?`, answer: phrase };
}

function deriveQuestionAndAnswer(unit: string): { question: string; answer: string } {
  const s = unit.trim();

  if (/\?$/.test(s)) {
    return { question: s, answer: trimAnswer(s.replace(/\?$/, ""), 40) };
  }

  // "X is/are/was/were/means/refers to Y"
  const def = s.match(/^(.{3,90}?)\s+(?:is|are|was|were|means|refers to)\s+(.+?)(?:\.|$)/i);
  if (def) {
    const subject = def[1]!.trim().replace(/^(?:a|an|the)\s+/i, "");
    const predicate = def[2]!.trim().replace(/[.]+$/, "");
    if (subject.length >= 2 && predicate.length >= 3) {
      return { question: `What is ${subject}?`, answer: trimAnswer(predicate, 40) };
    }
  }

  // "… called / known as X"
  const called = s.match(/\b(?:called|known as)\s+([A-Za-z][\w\s-]{2,50})(?:[.!,]|$)/i);
  if (called) {
    return {
      question: `What is ${called[1]!.trim()}?`,
      answer: trimAnswer(s, 50),
    };
  }

  // "X can/may/are used to …"
  const usedTo = s.match(
    /^(.{3,80}?)\s+(?:can|may|could|are|is|was|were)\s+(?:also\s+)?used\s+to\s+(.+?)(?:\.|$)/i,
  );
  if (usedTo) {
    const subject = usedTo[1]!.trim().replace(/^(?:a|an|the)\s+/i, "");
    return {
      question: `What can ${subject} be used to do?`,
      answer: trimAnswer(usedTo[2]!.trim().replace(/[.]+$/, ""), 40),
    };
  }

  // "X produces / causes / forms / generates Y"
  const produces = s.match(
    /^(.{3,80}?)\s+(?:produce|produces|cause|causes|form|forms|generate|generates|release|releases|contain|contains)\s+(.+?)(?:\.|$)/i,
  );
  if (produces) {
    const subject = produces[1]!.trim().replace(/^(?:a|an|the)\s+/i, "");
    const verb = (s.match(/\b(produce|produces|cause|causes|form|forms|generate|generates|release|releases|contain|contains)\b/i)?.[1] ?? "produce").toLowerCase();
    return {
      question: `What do ${subject} ${verb}?`,
      answer: trimAnswer(produces[2]!.trim().replace(/[.]+$/, ""), 40),
    };
  }

  // Linked contrast: "A, conversely, B" → ask about the relationship using full unit as answer
  if (/\bconversely\b/i.test(s) || /\bhowever\b/i.test(s)) {
    const lead = s.split(/,\s*(?:conversely|however)\b/i)[0]?.trim() ?? s;
    const topic = lead.match(/^((?:[A-Z][\w-]+(?:\s+[a-z][\w-]*){0,4}))/)?.[1] ?? lead.slice(0, 48);
    return {
      question: `How are ${topic.replace(/^(?:a|an|the)\s+/i, "")} related in this statement?`,
      answer: trimAnswer(s, 60),
    };
  }

  const cloze = clozeNounPhrase(s);
  if (cloze) return { question: cloze.question, answer: cloze.answer };

  // Last resort: ask for the key idea; answer is the full sentence (not a truncated echo).
  const leadNoun = s.match(/^((?:[A-Za-z][\w-]+(?:\s+[a-z][\w-]*){0,5}))/)?.[1]?.trim();
  if (leadNoun && leadNoun.length >= 4) {
    return {
      question: `What does the text say about ${leadNoun}?`,
      answer: trimAnswer(s, 60),
    };
  }

  return {
    question: `What is the main idea of this statement?`,
    answer: trimAnswer(s, 60),
  };
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
            "Copy a short answer phrase (max 20 words) from the context ONLY. No meta commentary. Prefer a complete clause.",
        },
        {
          role: "user",
          content: `Context:\n${context.slice(0, 900)}\n\nQuestion: ${question}\n\nShort phrase from context:`,
        },
      ],
      { maxTokens: 64, temperature: 0.05 },
    );
    const raw = trimAnswer(text.replaceAll(/^["']|["']$/g, "").trim(), 20);
    if (!raw || isMetaAnswer(raw) || raw.length < 2) return null;
    return raw;
  } catch {
    return null;
  }
}

function normaliseKey(s: string): string {
  return s.toLowerCase().replaceAll(/\s+/g, " ").trim().slice(0, 96);
}

function isLowQualityCard(question: string, answer: string): boolean {
  const q = question.trim();
  const a = answer.trim();
  if (q.length < 12 || a.length < 3) return true;
  // Reject the old awkward pattern if it ever appears.
  if (/^what does this state:/i.test(q)) return true;
  // Question and answer nearly identical (copy-paste cards).
  if (normaliseKey(q.replace(/\?$/, "")) === normaliseKey(a.replace(/\.$/, ""))) return true;
  return false;
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
            info: q.endsWith("?") ? q : `${q}?`,
            solution: { text: trimAnswer(a, 60) },
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
    const units = buildFlashCardUnits(sentences);

    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      onProgress?.(`Flash ${cards.length + 1} · ${block.id}`);

      let { question, answer } = deriveQuestionAndAnswer(unit);
      const key = normaliseKey(question);
      if (seen.has(key)) continue;

      // For definition-style answers that look thin, optionally refine with LLM.
      if (provider && (answer.split(/\s+/).length < 4 || /^(this|that|it)\b/i.test(answer))) {
        const window = units.slice(Math.max(0, i - 1), i + 2).join(" ");
        const llmAnswer = await answerWithLlm(provider, window, question);
        if (llmAnswer && !isMetaAnswer(llmAnswer)) answer = llmAnswer;
      }

      if (isMetaAnswer(answer) || answer.length < 2) answer = trimAnswer(unit, 60);
      if (isLowQualityCard(question, answer)) continue;

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
    if (/^what does this state:/i.test(card.info)) continue;

    const samePage = (byPage.get(card.page) ?? []).filter((c) => c.id !== card.id);
    const others = flashCards.filter((c) => c.id !== card.id);
    const pool = [...samePage, ...others.filter((c) => !samePage.includes(c))];

    const distractors: string[] = [];
    const used = new Set([normaliseKey(correct)]);
    for (const peer of pool) {
      const t = peer.solution.text.trim();
      const k = normaliseKey(t);
      if (!t || used.has(k)) continue;
      // Prefer distractors of similar length so options look plausible.
      if (Math.abs(t.split(/\s+/).length - correct.split(/\s+/).length) > 18) continue;
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
