import { MarkItDown } from "../convert/mark-it-down.js";
import { extractPdfBlocks } from "../pdf/pdf-extractor.js";
import type { PdfDocumentBlocks } from "../pdf/pdf-block-types.js";
import { basename, extname } from "../utils/path-name.js";
import {
  generateStudyPkc,
  type GenerateStudyPkcOptions,
  type GenerateStudyPkcResult,
} from "./generate-study-pkc.js";
import { markdownToStudyBlocks } from "./markdown-to-study-blocks.js";

export type GenerateStudyPkcFromBytesMeta = {
  filename?: string;
  extension?: string;
  mimetype?: string;
};

export type GenerateStudyPkcFromBytesOptions = GenerateStudyPkcOptions & {
  /** Pre-edited PDF blocks (e.g. from PdfCanvasEditor). Skips extract when set. */
  pdfBlocks?: PdfDocumentBlocks | null;
  /**
   * When true (default for `.pdf`), use MuPDF extract path.
   * When false, always MarkItDown → markdownToStudyBlocks.
   */
  preferPdfBlocks?: boolean;
};

function resolveExtension(meta: GenerateStudyPkcFromBytesMeta): string {
  const fromMeta = (meta.extension ?? "").trim();
  if (fromMeta) {
    return fromMeta.startsWith(".") ? fromMeta.toLowerCase() : `.${fromMeta.toLowerCase()}`;
  }
  if (meta.filename) return extname(meta.filename).toLowerCase();
  return "";
}

function isPdfMeta(meta: GenerateStudyPkcFromBytesMeta): boolean {
  const ext = resolveExtension(meta);
  const mime = (meta.mimetype ?? "").toLowerCase();
  return ext === ".pdf" || mime === "application/pdf" || mime === "application/x-pdf";
}

async function markdownBlocksFromBytes(
  bytes: Uint8Array,
  meta: GenerateStudyPkcFromBytesMeta,
  options: GenerateStudyPkcFromBytesOptions,
  title: string | null,
  source: string,
): Promise<PdfDocumentBlocks> {
  const converter = new MarkItDown({
    llmProvider: options.llmProvider ?? undefined,
  });
  const converted = await converter.convertBytes(bytes, {
    filename: meta.filename ?? "document",
    extension: resolveExtension(meta) || undefined,
    mimetype: meta.mimetype,
  });
  return markdownToStudyBlocks(converted.markdown ?? "", {
    title: converted.title ?? title,
    source,
  });
}

/**
 * Bytes-in study PKC: PDF → extract (or use provided blocks); other formats →
 * MarkItDown markdown → {@link markdownToStudyBlocks} → {@link generateStudyPkc}.
 */
export async function generateStudyPkcFromBytes(
  bytes: Uint8Array,
  meta: GenerateStudyPkcFromBytesMeta = {},
  options: GenerateStudyPkcFromBytesOptions = {},
): Promise<GenerateStudyPkcResult> {
  const filename = meta.filename ?? "document";
  const title = options.title ?? (basename(filename).replace(/\.[^.]+$/, "") || null);
  const source = options.source ?? filename;
  const onProgress = options.onProgress;

  let pdfBlocks: PdfDocumentBlocks;

  if (options.pdfBlocks) {
    pdfBlocks = options.pdfBlocks;
  } else if (options.preferPdfBlocks !== false && isPdfMeta(meta)) {
    onProgress?.("Extracting PDF blocks…");
    try {
      pdfBlocks = await extractPdfBlocks(bytes);
      if (!pdfBlocks.title && title) pdfBlocks.title = title;
    } catch {
      onProgress?.("PDF extract failed — converting via MarkItDown…");
      pdfBlocks = await markdownBlocksFromBytes(bytes, meta, options, title, source);
    }
  } else {
    onProgress?.("Converting document…");
    pdfBlocks = await markdownBlocksFromBytes(bytes, meta, options, title, source);
  }

  return generateStudyPkc(pdfBlocks, {
    ...options,
    title: options.title ?? pdfBlocks.title ?? title,
    source,
  });
}
