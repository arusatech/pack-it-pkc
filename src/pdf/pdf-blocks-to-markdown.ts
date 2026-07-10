import type { PdfBlock, PdfDocumentBlocks, PdfTableBlock } from "./pdf-block-types.js";
import { mergePartialNumberingLines } from "./merge-partial-numbering.js";

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
    case "heading":
      return block.content.trim().startsWith("#")
        ? block.content.trim()
        : `# ${block.content.trim()}`;
    case "list":
    case "text":
      return block.content.trim();
    case "table": {
      const table = block as PdfTableBlock;
      if (table.content.trim()) return table.content.trim();
      return tableRowsToMarkdown(table.rows);
    }
    case "image": {
      const alt = block.content.trim() || "image";
      if (block.dataUrl) return `![${alt}](${block.dataUrl})`;
      return `![${alt}]()`;
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
