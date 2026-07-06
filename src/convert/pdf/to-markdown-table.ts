export function toMarkdownTable(table: string[][], includeSeparator = true): string {
  if (!table.length) return "";

  const normalized = table
    .map((row) => row.map((cell) => (cell ?? "").toString()))
    .filter((row) => row.some((cell) => cell.trim()));

  if (!normalized.length) return "";

  const colWidths = normalized[0].map((_, col) =>
    Math.max(3, ...normalized.map((row) => (row[col] ?? "").length)),
  );

  const fmtRow = (row: string[]) =>
    "|" + row.map((cell, i) => cell.padEnd(colWidths[i])).join("|") + "|";

  if (includeSeparator) {
    const [header, ...rows] = normalized;
    return [fmtRow(header), "|" + colWidths.map((w) => "-".repeat(w)).join("|") + "|", ...rows.map(fmtRow)].join(
      "\n",
    );
  }

  return normalized.map(fmtRow).join("\n");
}
