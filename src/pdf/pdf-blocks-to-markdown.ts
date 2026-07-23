import type { PdfBlock, PdfDocumentBlocks, PdfQaBlock, PdfTableBlock } from "./pdf-block-types.js";
import { qaPartsToContent } from "./pdf-qa.js";
import { mergePartialNumberingLines } from "./merge-partial-numbering.js";
import { normalizeChemistryMarkupForStudy } from "./chemistry-normalize.js";

export function tableRowsToMarkdown(rows: string[][]): string {
  if (!rows.length) return "";

  const colCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const copy = [...row];
    while (copy.length < colCount) copy.push("");
    return copy;
  });

  const colWidths = Array.from({ length: colCount }, (_, col) =>
    Math.max(3, ...normalized.map((row) => (row[col] ?? "").length)),
  );

  const lines: string[] = [];
  const header = normalized[0]!;
  lines.push("| " + header.map((cell, ci) => cell.padEnd(colWidths[ci]!)).join(" | ") + " |");
  lines.push("| " + colWidths.map((w) => "-".repeat(w)).join(" | ") + " |");
  for (const row of normalized.slice(1)) {
    lines.push("| " + row.map((cell, ci) => cell.padEnd(colWidths[ci]!)).join(" | ") + " |");
  }
  return lines.join("\n");
}

function renderBlock(block: PdfBlock): string {
  switch (block.type) {
    case "heading": {
      const body = normalizeChemistryMarkupForStudy(block.content.trim());
      return body.startsWith("#") ? body : `# ${body}`;
    }
    case "list":
    case "text":
      return normalizeChemistryMarkupForStudy(block.content.trim());
    case "table": {
      const table = block as PdfTableBlock;
      if (table.content.trim()) return normalizeChemistryMarkupForStudy(table.content.trim());
      return tableRowsToMarkdown(table.rows);
    }
    case "image": {
      const alt = block.content.trim() || "image";
      const markdown = block.dataUrl ? `![${alt}](${block.dataUrl})` : `![${alt}]()`;
      const ocr = block.ocrText?.trim();
      return ocr ? `${markdown}\n\n${normalizeChemistryMarkupForStudy(ocr)}` : markdown;
    }
    case "qa": {
      const qa = block as PdfQaBlock;
      return qaPartsToContent(
        normalizeChemistryMarkupForStudy(qa.question.content),
        normalizeChemistryMarkupForStudy(qa.answer.content),
      );
    }
  }
}

/** Convert an edited block document to markdown. */
export function blocksToMarkdown(doc: PdfDocumentBlocks): string {
  const chunks: string[] = [];

  for (let pageIndex = 0; pageIndex < doc.pageCount; pageIndex++) {
    const page = doc.pages[String(pageIndex)];
    if (!page) continue;

    for (const blockId of page.order) {
      const block = page.blocks[blockId];
      if (!block) continue;
      const rendered = renderBlock(block);
      if (rendered) chunks.push(rendered);
    }
  }

  return mergePartialNumberingLines(chunks.join("\n\n").trim());
}

/** Sync table `content` markdown from editable `rows`. */
export function syncTableBlockContent(block: PdfTableBlock): PdfTableBlock {
  return {
    ...block,
    content: tableRowsToMarkdown(block.rows),
  };
}
