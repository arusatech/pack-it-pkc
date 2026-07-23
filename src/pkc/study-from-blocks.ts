import type { PdfBlock, PdfDocumentBlocks, PdfQaBlock } from "../pdf/pdf-block-types.js";
import { blocksToMarkdown } from "../pdf/pdf-blocks-to-markdown.js";
import { asQaBlock, isQaSegment } from "../pdf/pdf-qa.js";
import {
  contentHasChemistryMarkup,
  normalizeChemistryMarkupForStudy,
} from "../pdf/chemistry-normalize.js";
import type { StudyBlock, StudyBlockKind } from "./study-types.js";

function kindForBlock(block: PdfBlock): StudyBlockKind {
  if (block.type === "qa" || isQaSegment(block)) return "qa";
  if (block.segmentTag === "formula") return "formula";
  if (block.segmentTag === "math") return "math";
  if (block.type === "image" || block.segmentTag === "image") return "image";
  if (block.type === "table" || block.segmentTag === "table") return "table";
  if (block.type === "heading") return "heading";
  if (block.type === "list") return "list";
  return "text";
}

function contentFormatFor(block: PdfBlock, content: string): StudyBlock["contentFormat"] {
  if (block.contentFormat === "mhchem" || block.contentFormat === "latex" || block.contentFormat === "mixed") {
    return block.contentFormat;
  }
  if (contentHasChemistryMarkup(content)) return "mixed";
  return block.contentFormat ?? "plain";
}

function toStudyBlock(block: PdfBlock): StudyBlock {
  const kind = kindForBlock(block);
  const normalizedContent = normalizeChemistryMarkupForStudy(block.content ?? "");
  const base: StudyBlock = {
    id: block.id,
    page: block.page,
    kind,
    title: block.title,
    content: normalizedContent,
    bbox: { ...block.bbox },
    contentFormat: contentFormatFor(block, normalizedContent),
  };

  if (kind === "qa") {
    const qa: PdfQaBlock = block.type === "qa" ? block : asQaBlock(block);
    base.question = normalizeChemistryMarkupForStudy(qa.question.content);
    base.answer = normalizeChemistryMarkupForStudy(qa.answer.content);
    base.content = [base.question, base.answer].filter(Boolean).join("\n\n");
    base.contentFormat = contentFormatFor(block, base.content);
  }

  if (kind === "image" && block.type === "image" && block.dataUrl) {
    base.dataUrl = block.dataUrl;
  }

  return base;
}

/** Flatten PdfDocumentBlocks into ordered StudyBlock[] plus markdown. */
export function blocksToStudyDocumentParts(doc: PdfDocumentBlocks): {
  blocks: StudyBlock[];
  markdown: string;
} {
  const blocks: StudyBlock[] = [];
  for (let pageIndex = 0; pageIndex < doc.pageCount; pageIndex++) {
    const page = doc.pages[String(pageIndex)];
    if (!page) continue;
    for (const blockId of page.order) {
      const block = page.blocks[blockId];
      if (!block) continue;
      blocks.push(toStudyBlock(block));
    }
  }
  return {
    blocks,
    markdown: blocksToMarkdown(doc),
  };
}
