import type { PdfDocumentBlocks } from "../../src/convert/pdf/pdf-block-types.js";

const STORAGE_PREFIX = "pack-it-pkc:pdf-blocks:";

export interface SavePdfBlocksOptions {
  /** Omit large image data URLs from persisted JSON (default true). */
  stripImageData?: boolean;
}

function storageKey(sourceFile: string): string {
  return `${STORAGE_PREFIX}${sourceFile}`;
}

/** Strip heavy image payloads before localStorage (keeps bbox + caption). */
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

export function savePdfBlocksLocal(
  sourceFile: string,
  doc: PdfDocumentBlocks,
  options?: SavePdfBlocksOptions,
): void {
  const strip = options?.stripImageData !== false;
  const payload = strip ? stripPdfBlocksForStorage(doc) : doc;
  try {
    localStorage.setItem(storageKey(sourceFile), JSON.stringify(payload));
  } catch (err) {
    console.warn("[pdf-blocks-storage] localStorage save failed", err);
  }
}

export function loadPdfBlocksLocal(sourceFile: string): PdfDocumentBlocks | null {
  try {
    const raw = localStorage.getItem(storageKey(sourceFile));
    if (!raw) return null;
    return JSON.parse(raw) as PdfDocumentBlocks;
  } catch {
    return null;
  }
}

export function clearPdfBlocksLocal(sourceFile: string): void {
  localStorage.removeItem(storageKey(sourceFile));
}
