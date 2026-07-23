import type { PdfBlock, PdfDocumentBlocks, PdfTextBlock } from "../pdf/pdf-block-types.js";

export type MarkdownToStudyBlocksOptions = {
  title?: string | null;
  source?: string | null;
  /** Synthetic page width/height for bbox placeholders (default 612×792). */
  pageWidth?: number;
  pageHeight?: number;
};

function emptyPage(width: number, height: number): PdfDocumentBlocks["pages"][string] {
  return { width, height, blocks: {}, order: [] };
}

function looksLikeTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) return false;
  // GFM separator or a row with at least two cells
  if (/^\|?\s*:?-{3,}/.test(t)) return true;
  const cells = t.split("|").filter((c) => c.trim().length > 0);
  return cells.length >= 2;
}

function parseTableRows(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^\|?\s*:?-{3,}/.test(t)) continue;
    const cells = t
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }
  return rows;
}

/**
 * Convert Markdown (e.g. MarkItDown output) into a single-page {@link PdfDocumentBlocks}
 * tree so {@link generateStudyPkc} can chunk / embed / flash / MCQ without a PDF canvas.
 */
export function markdownToStudyBlocks(
  markdown: string,
  options: MarkdownToStudyBlocksOptions = {},
): PdfDocumentBlocks {
  const pageWidth = options.pageWidth ?? 612;
  const pageHeight = options.pageHeight ?? 792;
  const page = emptyPage(pageWidth, pageHeight);
  const doc: PdfDocumentBlocks = {
    version: 1,
    title: options.title ?? null,
    pageCount: 1,
    pages: { "0": page },
  };

  const text = (markdown ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return doc;

  const paragraphs = text.split(/\n{2,}/);
  let y = 48;
  let blockIndex = 0;

  const pushBlock = (block: PdfBlock) => {
    page.blocks[block.id] = block;
    page.order.push(block.id);
    blockIndex += 1;
    y += Math.max(24, block.bbox.h + 8);
  };

  for (const raw of paragraphs) {
    const para = raw.trim();
    if (!para) continue;

    const lines = para.split("\n").map((l) => l.trimEnd());
    const first = lines[0]!.trim();

    // Heading: # … ###### 
    const headingMatch = first.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && lines.length === 1) {
      const content = headingMatch[2]!.trim();
      const id = `md-p0-b${blockIndex}`;
      const block: PdfTextBlock = {
        id,
        type: "heading",
        page: 0,
        bbox: { x: 48, y, w: pageWidth - 96, h: 28 },
        content,
        title: content.slice(0, 80),
        segmentTag: "text",
        contentFormat: "plain",
        lines: [content],
      };
      pushBlock(block);
      continue;
    }

    // GFM / pipe table
    if (lines.every((l) => looksLikeTableRow(l)) && lines.length >= 2) {
      const rows = parseTableRows(lines);
      if (rows.length > 0) {
        const id = `md-p0-b${blockIndex}`;
        const content = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
        pushBlock({
          id,
          type: "table",
          page: 0,
          bbox: { x: 48, y, w: pageWidth - 96, h: Math.max(40, rows.length * 18) },
          content,
          rows,
          segmentTag: "table",
          contentFormat: "plain",
        });
        continue;
      }
    }

    // Unordered / ordered list
    const listLike = lines.every((l) => /^\s*([-*+]|\d+\.)\s+/.test(l));
    if (listLike) {
      const content = lines
        .map((l) => l.replace(/^\s*([-*+]|\d+\.)\s+/, "").trim())
        .filter(Boolean)
        .join("\n");
      const id = `md-p0-b${blockIndex}`;
      pushBlock({
        id,
        type: "list",
        page: 0,
        bbox: { x: 48, y, w: pageWidth - 96, h: Math.max(24, lines.length * 18) },
        content,
        segmentTag: "text",
        contentFormat: "plain",
        lines: content.split("\n"),
      });
      continue;
    }

    const content = lines.join("\n").trim();
    if (!content) continue;
    const id = `md-p0-b${blockIndex}`;
    pushBlock({
      id,
      type: "text",
      page: 0,
      bbox: { x: 48, y, w: pageWidth - 96, h: Math.max(24, Math.min(200, content.length / 4)) },
      content,
      segmentTag: "text",
      contentFormat: "plain",
      lines: content.split("\n"),
    });
  }

  return doc;
}
