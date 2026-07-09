import mupdf from "mupdf";
import type { ExtractPdfBlocksOptions, PdfDocumentBlocks } from "./pdf-block-types.js";
import { blocksToMarkdown } from "./pdf-blocks-to-markdown.js";
import { buildPdfDocumentBlocks, extractPageBlocksFromPage } from "./pdf-block-extractor.js";
import { mergePartialNumberingLines } from "./merge-partial-numbering.js";

export interface PdfExtractResult {
  markdown: string;
  title?: string | null;
  blocks?: PdfDocumentBlocks;
}

export interface ExtractPdfOptions extends ExtractPdfBlocksOptions {
  /** Optional hook to edit blocks before markdown export. */
  editBlocks?: (doc: PdfDocumentBlocks) => PdfDocumentBlocks;
}

/** Parse PDF into sorted, typed, editable blocks (nested JSON dicts). */
export async function extractPdfBlocks(
  bytes: Uint8Array,
  options?: ExtractPdfBlocksOptions,
): Promise<PdfDocumentBlocks> {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");

  try {
    const title = doc.getMetaData(mupdf.Document.META_INFO_TITLE) ?? null;
    const pageResults: Array<{ width: number; height: number; blocks: import("./pdf-block-types.js").PdfBlock[] }> =
      [];

    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      try {
        pageResults.push(extractPageBlocksFromPage(page, i, options));
      } finally {
        page.destroy();
      }
    }

    return buildPdfDocumentBlocks(pageResults, { title });
  } finally {
    doc.destroy();
  }
}

/** Full pipeline: PDF → blocks (editable) → markdown. */
export async function extractPdfMarkdown(
  bytes: Uint8Array,
  options?: ExtractPdfOptions,
): Promise<PdfExtractResult> {
  const blocks = await extractPdfBlocks(bytes, options);
  const edited = options?.editBlocks ? options.editBlocks(blocks) : blocks;
  const markdown = mergePartialNumberingLines(blocksToMarkdown(edited).trim());

  return {
    markdown,
    title: edited.title ?? null,
    blocks: edited,
  };
}
