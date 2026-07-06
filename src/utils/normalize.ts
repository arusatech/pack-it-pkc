/** Normalize markdown whitespace (matches Python MarkItDown post-processing). */
export function normalizeMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/).map((line) => line.replace(/\s+$/, ""));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
