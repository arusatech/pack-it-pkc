import { extractFormSegmentsFromWords } from "./extract-form-segments.js";
import { tableRowsToMarkdown } from "./pdf-blocks-to-markdown.js";
import type { PdfPageLike } from "./pdf-word-types.js";

export type { PdfPageLike, PdfWord } from "./pdf-word-types.js";

/**
 * Extract form-style content from a PDF page by analyzing word positions.
 * Port of Python MarkItDown `_extract_form_content_from_words`.
 */
export function extractFormContentFromWords(page: PdfPageLike): string | null {
  const segments = extractFormSegmentsFromWords(page);
  if (!segments) return null;

  const lines: string[] = [];
  for (const segment of segments) {
    if (segment.type === "table") {
      lines.push(tableRowsToMarkdown(segment.rows));
    } else {
      lines.push(segment.text);
    }
  }
  return lines.join("\n");
}
