import type { PdfBlock, PdfQaBlock, PdfQaPart } from "./pdf-block-types.js";

export const QA_PLACEHOLDER = "**Q:** \n\n**A:** ";

export function qaPartsToContent(question: string, answer: string): string {
  const parts: string[] = [];
  const q = question.trim();
  const a = answer.trim();
  if (q) parts.push(`**Q:** ${q}`);
  if (a) parts.push(`**A:** ${a}`);
  return parts.join("\n\n");
}

export function parseQaFromContent(content: string): { question: string; answer: string } {
  const trimmed = content.trim();
  if (!trimmed) return { question: "", answer: "" };

  const qaMatch = trimmed.match(/^\*\*Q:\*\*\s*([\s\S]*?)(?:\n\n\*\*A:\*\*\s*([\s\S]*))?$/i);
  if (qaMatch) {
    return {
      question: (qaMatch[1] ?? "").trim(),
      answer: (qaMatch[2] ?? "").trim(),
    };
  }

  if (/^\*\*Q:\*\*/i.test(trimmed)) {
    return { question: trimmed.replace(/^\*\*Q:\*\*\s*/i, "").trim(), answer: "" };
  }
  if (/^\*\*A:\*\*/i.test(trimmed)) {
    return { question: "", answer: trimmed.replace(/^\*\*A:\*\*\s*/i, "").trim() };
  }

  return { question: trimmed, answer: "" };
}

export function isQaSegment(block: PdfBlock): boolean {
  return (
    block.type === "qa" ||
    block.segmentTag === "qa" ||
    block.segmentTag === "question" ||
    block.segmentTag === "answer"
  );
}

export function asQaBlock(block: PdfBlock): PdfQaBlock {
  if (block.type === "qa") return block;

  const { question, answer } = parseQaFromContent(block.content);
  return {
    id: block.id,
    type: "qa",
    page: block.page,
    bbox: block.bbox,
    title: block.title,
    segmentTag: "qa",
    question: qaPart(question),
    answer: qaPart(answer),
    content: qaPartsToContent(question, answer),
  };
}

export function qaPart(content: string): PdfQaPart {
  return { content, lines: content ? content.split("\n") : [] };
}

export function isQaAnswerEmpty(block: PdfQaBlock): boolean {
  return !block.answer.content.trim();
}

export function isQaPlaceholder(block: PdfBlock): boolean {
  if (block.type === "qa") {
    const q = block.question.content.trim();
    const a = block.answer.content.trim();
    if (!q && !a) return true;
    if (!a && (q === QA_PLACEHOLDER.trim() || q === "**Q:**")) return true;
    const title = block.title?.trim() ?? "";
    if (!a && title && q === title) return true;
    return false;
  }

  if (!isQaSegment(block)) return false;
  const { question, answer } = parseQaFromContent(block.content);
  if (answer.trim()) return false;
  const title = block.title?.trim() ?? "";
  if (title && question === title) return true;
  if (question === QA_PLACEHOLDER.trim() || question === "**Q:**") return true;
  return !question.trim();
}
