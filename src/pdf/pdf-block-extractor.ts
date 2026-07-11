import type { Image, Page, Rect } from "mupdf";
import { toBase64 } from "../utils/binary.js";
import { extractFormSegmentsFromWords } from "./extract-form-segments.js";
import { pageToWords } from "./mupdf-words.js";
import type {
  ExtractPdfBlocksOptions,
  PdfBlock,
  PdfDocumentBlocks,
  PdfImageBlock,
  PdfPageBlocks,
  PdfTableBlock,
  PdfTextBlock,
} from "./pdf-block-types.js";
import { rectToBbox, sortBlocksByPosition } from "./pdf-block-types.js";
import { tableRowsToMarkdown } from "./pdf-blocks-to-markdown.js";

interface MupdfLineJson {
  text?: string;
  font?: { size?: number };
  bbox?: { x: number; y: number; w: number; h: number };
}

interface MupdfBlockJson {
  type?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  lines?: MupdfLineJson[];
}

interface MupdfStextJson {
  blocks?: MupdfBlockJson[];
}

function bytesToBase64(bytes: Uint8Array): string {
  return toBase64(bytes);
}

function detectListType(text: string): "list" | "text" {
  return /^\s*([•·▪◦\-*]|\d+[.)])\s+\S/.test(text) ? "list" : "text";
}

function textBlocksFromStructuredJson(
  json: MupdfStextJson,
  pageIndex: number,
  headingScale: number,
): PdfTextBlock[] {
  const blocks: PdfTextBlock[] = [];
  const fontSizes: number[] = [];

  for (const block of json.blocks ?? []) {
    if (block.type !== "text") continue;
    for (const line of block.lines ?? []) {
      if (line.font?.size) fontSizes.push(line.font.size);
    }
  }

  const medianSize =
    fontSizes.length > 0
      ? [...fontSizes].sort((a, b) => a - b)[Math.floor(fontSizes.length / 2)]!
      : 12;
  const headingThreshold = medianSize * headingScale;

  for (const block of json.blocks ?? []) {
    if (block.type !== "text" || !block.bbox) continue;

    const lines = (block.lines ?? [])
      .map((line) => line.text ?? "")
      .filter((t) => t.trim().length > 0);
    if (!lines.length) continue;

    const content = lines.join("\n").trim();
    const maxFont = Math.max(
      ...(block.lines ?? []).map((line) => line.font?.size ?? medianSize),
    );
    const listType = detectListType(content);
    let type: PdfTextBlock["type"] = listType;
    if (listType === "text" && maxFont >= headingThreshold && content.length < 200) {
      type = "heading";
    }

    blocks.push({
      id: "",
      type,
      page: pageIndex,
      bbox: block.bbox,
      content,
      lines,
    });
  }

  return blocks;
}

function imageBlocksFromPage(page: Page, pageIndex: number): PdfImageBlock[] {
  const images: Array<{ bbox: Rect; width: number; height: number; dataUrl: string }> = [];
  const stext = page.toStructuredText("preserve-images");
  try {
    stext.walk({
      onImageBlock(bbox, _transform, image: Image) {
        const pixmap = image.toPixmap();
        try {
          const png = pixmap.asPNG();
          images.push({
            bbox,
            width: image.getWidth(),
            height: image.getHeight(),
            dataUrl: `data:image/png;base64,${bytesToBase64(png)}`,
          });
        } finally {
          pixmap.destroy();
        }
      },
    });
  } finally {
    stext.destroy();
  }

  return images.map((img, index) => ({
    id: "",
    type: "image" as const,
    page: pageIndex,
    bbox: rectToBbox(img.bbox),
    content: `Image ${index + 1}`,
    width: img.width,
    height: img.height,
    dataUrl: img.dataUrl,
  }));
}

function formSegmentsToBlocks(
  segments: ReturnType<typeof extractFormSegmentsFromWords>,
  pageIndex: number,
): PdfBlock[] {
  if (!segments) return [];

  return segments.map((segment) => {
    if (segment.type === "table") {
      const rows = segment.rows.map((row) => [...row]);
      const tableBlock: PdfTableBlock = {
        id: "",
        type: "table",
        page: pageIndex,
        bbox: segment.bbox,
        rows,
        content: tableRowsToMarkdown(rows),
      };
      return tableBlock;
    }

    const textBlock: PdfTextBlock = {
      id: "",
      type: detectListType(segment.text),
      page: pageIndex,
      bbox: segment.bbox,
      content: segment.text,
      lines: segment.text.split("\n"),
    };
    return textBlock;
  });
}

function extractPageBlocks(
  page: Page,
  pageIndex: number,
  options: Required<ExtractPdfBlocksOptions>,
): PdfBlock[] {
  const pageLike = pageToWords(page);
  const formSegments = extractFormSegmentsFromWords(pageLike);
  const blocks: PdfBlock[] = [];

  if (formSegments) {
    blocks.push(...formSegmentsToBlocks(formSegments, pageIndex));
  } else {
    const stext = page.toStructuredText("preserve-whitespace");
    try {
      const json = JSON.parse(stext.asJSON()) as MupdfStextJson;
      blocks.push(...textBlocksFromStructuredJson(json, pageIndex, options.headingScale));
    } finally {
      stext.destroy();
    }
  }

  blocks.push(...imageBlocksFromPage(page, pageIndex));

  const sorted = options.sort ? sortBlocksByPosition(blocks) : blocks;
  return sorted.map((block, index) => ({
    ...block,
    id: `p${pageIndex}-b${index}`,
    page: pageIndex,
  }));
}

export function extractPageBlocksFromPage(
  page: Page,
  pageIndex: number,
  options?: ExtractPdfBlocksOptions,
): { width: number; height: number; blocks: PdfBlock[] } {
  const resolved: Required<ExtractPdfBlocksOptions> = {
    sort: options?.sort ?? true,
    headingScale: options?.headingScale ?? 1.35,
  };
  const bounds = page.getBounds();
  const blocks = extractPageBlocks(page, pageIndex, resolved);
  return {
    width: bounds[2] - bounds[0],
    height: bounds[3] - bounds[1],
    blocks,
  };
}

export function buildPdfDocumentBlocks(
  pageResults: Array<{ width: number; height: number; blocks: PdfBlock[] }>,
  meta?: { title?: string | null },
): PdfDocumentBlocks {
  const pages: Record<string, PdfPageBlocks> = {};

  pageResults.forEach((result, pageIndex) => {
    const blocksMap: Record<string, PdfBlock> = {};
    const order: string[] = [];
    for (const block of result.blocks) {
      blocksMap[block.id] = block;
      order.push(block.id);
    }
    pages[String(pageIndex)] = {
      width: result.width,
      height: result.height,
      blocks: blocksMap,
      order,
    };
  });

  return {
    version: 1,
    title: meta?.title ?? null,
    pageCount: pageResults.length,
    pages,
  };
}

/** Get a single block by id (`p0-b2`) from a document model. */
export function getPdfBlock(doc: PdfDocumentBlocks, blockId: string): PdfBlock | undefined {
  const pageKey = blockId.match(/^p(\d+)-/)?.[1];
  if (!pageKey) return undefined;
  return doc.pages[pageKey]?.blocks[blockId];
}

/** Replace a block in the document model (for editors). */
export function setPdfBlock(doc: PdfDocumentBlocks, block: PdfBlock): PdfDocumentBlocks {
  const pageKey = String(block.page);
  const page = doc.pages[pageKey];
  if (!page) return doc;

  return {
    ...doc,
    pages: {
      ...doc.pages,
      [pageKey]: {
        ...page,
        blocks: {
          ...page.blocks,
          [block.id]: block,
        },
      },
    },
  };
}
