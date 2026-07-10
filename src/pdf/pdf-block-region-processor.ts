import mupdf from "mupdf";
import { plainChemistryToMhchem } from "./chemistry-normalize.js";
import { extractFormSegmentsFromWords } from "./extract-form-segments.js";
import { plainMathToLatex } from "./math-normalize.js";
import { pageToWords } from "./mupdf-words.js";
import type { PdfBBox, PdfBlock, PdfQaBlock, PdfTableBlock, PdfTextBlock } from "./pdf-block-types.js";
import { tableRowsToMarkdown } from "./pdf-blocks-to-markdown.js";
import { asQaBlock, isQaSegment, qaPart, qaPartsToContent } from "./pdf-qa.js";
import type { PdfPageLike, PdfWord } from "./pdf-word-types.js";

/** Keep words with horizontal overlap and at least half their height inside the bbox. */
function wordOverlapsBbox(word: PdfWord, bbox: PdfBBox, minVerticalOverlap = 0.5): boolean {
  const bx0 = bbox.x;
  const by0 = bbox.y;
  const bx1 = bbox.x + bbox.w;
  const by1 = bbox.y + bbox.h;

  if (word.x1 <= bx0 || word.x0 >= bx1) return false;

  const overlapTop = Math.max(word.top, by0);
  const overlapBottom = Math.min(word.bottom, by1);
  const overlapH = Math.max(0, overlapBottom - overlapTop);
  const wordH = Math.max(1, word.bottom - word.top);

  return overlapH / wordH >= minVerticalOverlap;
}

function filterWordsInBbox(page: PdfPageLike, bbox: PdfBBox): PdfPageLike {
  const hPad = 2;
  const padded: PdfBBox = {
    x: bbox.x - hPad,
    y: bbox.y,
    w: bbox.w + hPad * 2,
    h: bbox.h,
  };

  const words = page.words.filter((w) => wordOverlapsBbox(w, padded));
  return { width: page.width, words };
}

function wordsToLines(words: PdfWord[]): string[] {
  if (!words.length) return [];

  const yTolerance = 5;
  const rowsByY = new Map<number, PdfWord[]>();

  for (const word of words) {
    const yKey = Math.round(word.top / yTolerance) * yTolerance;
    const row = rowsByY.get(yKey) ?? [];
    row.push(word);
    rowsByY.set(yKey, row);
  }

  return [...rowsByY.keys()]
    .sort((a, b) => a - b)
    .map((yKey) =>
      [...(rowsByY.get(yKey) ?? [])]
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.text)
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
}

function largestOverlapSegment<T extends { bbox: PdfBBox }>(segments: T[], bbox: PdfBBox): T | null {
  let best: T | null = null;
  let bestArea = 0;
  const area = bbox.w * bbox.h;

  for (const segment of segments) {
    const x0 = Math.max(bbox.x, segment.bbox.x);
    const y0 = Math.max(bbox.y, segment.bbox.y);
    const x1 = Math.min(bbox.x + bbox.w, segment.bbox.x + segment.bbox.w);
    const y1 = Math.min(bbox.y + bbox.h, segment.bbox.y + segment.bbox.h);
    const overlap = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    if (overlap > bestArea) {
      bestArea = overlap;
      best = segment;
    }
  }

  return bestArea >= area * 0.2 ? best : null;
}

/** Re-extract text/table content for a block bbox from the PDF bytes. */
export function processBlockRegionFromPdf(
  pdfBytes: Uint8Array,
  block: PdfBlock,
): Partial<PdfBlock> | null {
  if (block.type === "image" || block.segmentTag === "image") {
    return null;
  }

  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  try {
    const page = doc.loadPage(block.page);
    try {
      const pageWords = pageToWords(page);
      const region = filterWordsInBbox(pageWords, block.bbox);
      const lines = wordsToLines(region.words);
      const text = lines.join("\n").trim();

      const wantTable = block.type === "table" || block.segmentTag === "table";
      if (wantTable) {
        const segments = extractFormSegmentsFromWords(region);
        const tables = (segments ?? []).filter((s) => s.type === "table");
        const tableSeg = largestOverlapSegment(tables, block.bbox);

        if (tableSeg && tableSeg.type === "table") {
          const tablePatch: Partial<PdfTableBlock> = {
            type: "table",
            rows: tableSeg.rows,
            content: tableRowsToMarkdown(tableSeg.rows),
          };
          return tablePatch;
        }
      }

      const content = text || block.content;

      if (block.type === "qa" || isQaSegment(block)) {
        const qa = block.type === "qa" ? block : asQaBlock(block);
        const questionContent = text || qa.question.content;
        const qaPatch: Partial<PdfQaBlock> = {
          type: "qa",
          segmentTag: "qa",
          question: qaPart(questionContent),
          answer: qa.answer,
          content: qaPartsToContent(questionContent, qa.answer.content),
        };
        return qaPatch;
      }

      if (block.segmentTag === "formula") {
        const plain = text.trim() || stripFormulaPlaceholder(block.content);
        const mhchem = plain
          ? plainChemistryToMhchem(plain)
          : "(formula — no text found; edit manually)";
        const formulaPatch: Partial<PdfTextBlock> = {
          type: "text",
          segmentTag: "formula",
          contentFormat: "mhchem",
          content: mhchem,
          lines: mhchem.split("\n"),
        };
        return formulaPatch;
      }

      if (block.segmentTag === "math") {
        const plain = text.trim() || stripMathPlaceholder(block.content);
        const latex = plain
          ? plainMathToLatex(plain, plain.length > 60)
          : "(math — no text found; edit manually)";
        const mathPatch: Partial<PdfTextBlock> = {
          type: "text",
          segmentTag: "math",
          contentFormat: "latex",
          content: latex,
          lines: latex.split("\n"),
        };
        return mathPatch;
      }

      const textPatch: Partial<PdfTextBlock> = {
        type: block.type === "heading" || block.type === "list" ? block.type : "text",
        content,
        lines: content.split("\n"),
      };
      return textPatch;
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

function stripFormulaPlaceholder(content: string): string {
  const t = content.trim();
  if (!t || t === "$$\\cdots$$" || t === "Formula" || t === "\\ce{}") return "";
  return t;
}

function stripMathPlaceholder(content: string): string {
  const t = content.trim();
  if (!t || t === "$$\\cdots$$" || t === "Math") return "";
  return t;
}
