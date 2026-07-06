import { extractFormContentFromWords, type PdfPageLike, type PdfWord } from "./extract-form-content.js";
import { mergePartialNumberingLines } from "./merge-partial-numbering.js";

export interface PdfExtractResult {
  markdown: string;
  title?: string | null;
}

/** Extract PDF content with per-page form/table detection (pdfjs-dist). Falls back to pdf-parse. */
export async function extractPdfMarkdown(bytes: Uint8Array): Promise<PdfExtractResult> {
  let title: string | null = null;

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: bytes,
      useSystemFonts: true,
      disableFontFace: true,
    }).promise;

    const metadata = await doc.getMetadata().catch(() => null);
    const metaTitle = (metadata?.info as { Title?: string } | undefined)?.Title;
    if (metaTitle) title = metaTitle;

    const chunks: string[] = [];
    let formPageCount = 0;

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const pageLike = await pageToWords(page, viewport.height, viewport.width);

      const formContent = extractFormContentFromWords(pageLike);
      if (formContent !== null) {
        formPageCount++;
        if (formContent.trim()) chunks.push(formContent);
      } else {
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .trim();
        if (text) chunks.push(text);
      }
    }

    if (formPageCount === 0) {
      const fallback = await extractWithPdfParse(bytes);
      return { markdown: mergePartialNumberingLines(fallback.markdown), title: title ?? fallback.title };
    }

    return { markdown: mergePartialNumberingLines(chunks.join("\n\n").trim()), title };
  } catch {
    const fallback = await extractWithPdfParse(bytes);
    return { markdown: mergePartialNumberingLines(fallback.markdown), title: fallback.title };
  }
}

async function pageToWords(
  page: { getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[]; width?: number }> }> },
  pageHeight: number,
  pageWidth: number,
): Promise<PdfPageLike> {
  const textContent = await page.getTextContent();
  const words: PdfWord[] = [];

  for (const item of textContent.items) {
    if (!("str" in item) || !item.str || !item.transform) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width ?? item.str.length * 5;
    words.push({
      text: item.str,
      x0: x,
      x1: x + width,
      top: pageHeight - y,
    });
  }

  return { width: pageWidth, words };
}

async function extractWithPdfParse(bytes: Uint8Array): Promise<PdfExtractResult> {
  const mod = await import("pdf-parse");
  const pdfParse = (mod.default ?? mod) as (buf: Buffer) => Promise<{ text: string; info?: { Title?: string } }>;
  const result = await pdfParse(Buffer.from(bytes));
  return { markdown: result.text, title: result.info?.Title ?? null };
}
