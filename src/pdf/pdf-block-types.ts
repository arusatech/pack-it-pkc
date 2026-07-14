/** Axis-aligned bounding box in PDF page coordinates (origin top-left). */
export interface PdfBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PdfBlockType = "text" | "heading" | "list" | "table" | "image" | "qa";

export interface PdfBlockBase {
  /** Stable id, e.g. `p0-b3`. */
  id: string;
  type: PdfBlockType;
  /** 0-based page index. */
  page: number;
  bbox: PdfBBox;
  /** Primary editable payload (paragraph, caption, or markdown table). */
  content: string;
  /** Optional short label from canvas tagging. */
  title?: string;
  /** Canvas segment tag (text, question, table, formula, …). */
  segmentTag?: string;
  /** Hint for renderers: formula → mhchem; math → KaTeX LaTeX. */
  contentFormat?: "plain" | "mhchem" | "mixed" | "latex";
}

export interface PdfTextBlock extends PdfBlockBase {
  type: "text" | "heading" | "list";
  lines?: string[];
}

export interface PdfTableBlock extends PdfBlockBase {
  type: "table";
  rows: string[][];
}

export interface PdfImageBlock extends PdfBlockBase {
  type: "image";
  width: number;
  height: number;
  /** Compressed preview / markdown embedding (WebP/JPEG data URL). */
  dataUrl?: string;
  /** Full text found in the image region (PDF text layer / OCR). */
  ocrText?: string;
  /**
   * Search tokens from `ocrText` (same role as annadata-app `search_pattern_in_image`).
   */
  searchPatternInImage?: string[];
}

export interface PdfQaPart {
  content: string;
  lines?: string[];
}

/** Question + answer pair tagged on the canvas as one region. */
export interface PdfQaBlock extends PdfBlockBase {
  type: "qa";
  segmentTag: "qa";
  question: PdfQaPart;
  answer: PdfQaPart;
}

export type PdfBlock = PdfTextBlock | PdfTableBlock | PdfImageBlock | PdfQaBlock;

/** One page: blocks keyed by id plus sorted reading order. */
export interface PdfPageBlocks {
  width: number;
  height: number;
  blocks: Record<string, PdfBlock>;
  order: string[];
}

/**
 * Full document intermediate representation (nested dicts).
 * Edit any `blocks[id].content` (or `rows` on tables) before markdown export.
 */
export interface PdfDocumentBlocks {
  version: 1;
  title?: string | null;
  pageCount: number;
  pages: Record<string, PdfPageBlocks>;
}

export interface ExtractPdfBlocksOptions {
  /** Reading order: top-to-bottom, then left-to-right (default true). */
  sort?: boolean;
  /** Font size ratio above median line size → heading block (default 1.35). */
  headingScale?: number;
}

export function rectToBbox(rect: [number, number, number, number]): PdfBBox {
  const [x0, y0, x1, y1] = rect;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function wordsToBbox(words: Array<{ x0: number; x1: number; top: number; bottom?: number }>): PdfBBox {
  const x0 = Math.min(...words.map((w) => w.x0));
  const x1 = Math.max(...words.map((w) => w.x1));
  const top = Math.min(...words.map((w) => w.top));
  const bottom = Math.max(...words.map((w) => w.bottom ?? w.top + 14));
  return { x: x0, y: top, w: x1 - x0, h: bottom - top };
}

export function unionBbox(a: PdfBBox, b: PdfBBox): PdfBBox {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function sortBlocksByPosition<T extends { bbox: PdfBBox }>(blocks: T[]): T[] {
  return [...blocks].sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y;
    if (Math.abs(dy) > 4) return dy;
    return a.bbox.x - b.bbox.x;
  });
}
