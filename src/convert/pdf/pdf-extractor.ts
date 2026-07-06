import mupdf from "mupdf";
import { extractFormContentFromWords } from "./extract-form-content.js";
import { mergePartialNumberingLines } from "./merge-partial-numbering.js";
import { pageToWords } from "./mupdf-words.js";

export interface PdfExtractResult {
  markdown: string;
  title?: string | null;
}

/** Extract PDF content with per-page form/table detection (MuPDF.js). */
export async function extractPdfMarkdown(bytes: Uint8Array): Promise<PdfExtractResult> {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");

  try {
    const title = doc.getMetaData(mupdf.Document.META_INFO_TITLE) ?? null;
    const chunks: string[] = [];

    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      try {
        const pageLike = pageToWords(page);
        const formContent = extractFormContentFromWords(pageLike);

        if (formContent !== null) {
          if (formContent.trim()) chunks.push(formContent);
        } else {
          const stext = page.toStructuredText("preserve-whitespace");
          try {
            const text = stext.asText().trim();
            if (text) chunks.push(text);
          } finally {
            stext.destroy();
          }
        }
      } finally {
        page.destroy();
      }
    }

    return { markdown: mergePartialNumberingLines(chunks.join("\n\n").trim()), title };
  } finally {
    doc.destroy();
  }
}
