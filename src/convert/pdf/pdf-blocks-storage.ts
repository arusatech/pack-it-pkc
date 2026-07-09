import type { PdfDocumentBlocks } from "./pdf-block-types.js";

const STORAGE_PREFIX = "pack-it-pkc:pdf-blocks:";

export interface SavePdfBlocksOptions {
  stripImageData?: boolean;
}

function storageKey(sourceFile: string): string {
  return `${STORAGE_PREFIX}${sourceFile}`;
}

export function stripPdfBlocksForStorage(doc: PdfDocumentBlocks): PdfDocumentBlocks {
  const pages: PdfDocumentBlocks["pages"] = {};
  for (const [pageKey, page] of Object.entries(doc.pages)) {
    const blocks: typeof page.blocks = {};
    for (const [id, block] of Object.entries(page.blocks)) {
      if (block.type === "image") {
        const { dataUrl: _drop, ...rest } = block;
        blocks[id] = { ...rest };
      } else {
        blocks[id] = block;
      }
    }
    pages[pageKey] = { ...page, blocks };
  }
  return { ...doc, pages };
}

/** Persist block JSON in `localStorage` (browser) keyed by source filename. */
export function savePdfBlocksLocal(
  sourceFile: string,
  doc: PdfDocumentBlocks,
  options?: SavePdfBlocksOptions,
): void {
  if (typeof localStorage === "undefined") return;
  const strip = options?.stripImageData !== false;
  const payload = strip ? stripPdfBlocksForStorage(doc) : doc;
  try {
    localStorage.setItem(storageKey(sourceFile), JSON.stringify(payload));
  } catch (err) {
    console.warn("[savePdfBlocksLocal]", err);
  }
}

export function loadPdfBlocksLocal(sourceFile: string): PdfDocumentBlocks | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(sourceFile));
    if (!raw) return null;
    return JSON.parse(raw) as PdfDocumentBlocks;
  } catch {
    return null;
  }
}

export function clearPdfBlocksLocal(sourceFile: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(storageKey(sourceFile));
}
