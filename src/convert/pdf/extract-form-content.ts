import { PARTIAL_NUMBERING_PATTERN } from "./merge-partial-numbering.js";

export interface PdfWord {
  text: string;
  x0: number;
  x1: number;
  top: number;
}

export interface PdfPageLike {
  width: number;
  words: PdfWord[];
}

interface RowInfo {
  words: PdfWord[];
  text: string;
  xGroups: number[];
  isParagraph: boolean;
  numColumns: number;
  hasPartialNumbering: boolean;
  isTableRow?: boolean;
}

/**
 * Extract form-style content from a PDF page by analyzing word positions.
 * Port of Python MarkItDown `_extract_form_content_from_words`.
 */
export function extractFormContentFromWords(page: PdfPageLike): string | null {
  const words = page.words;
  if (!words.length) return null;

  const yTolerance = 5;
  const rowsByY = new Map<number, PdfWord[]>();

  for (const word of words) {
    const yKey = Math.round(word.top / yTolerance) * yTolerance;
    const row = rowsByY.get(yKey) ?? [];
    row.push(word);
    rowsByY.set(yKey, row);
  }

  const sortedYKeys = [...rowsByY.keys()].sort((a, b) => a - b);
  const pageWidth = page.width || 612;

  const rowInfo: RowInfo[] = [];
  for (const yKey of sortedYKeys) {
    const rowWords = [...(rowsByY.get(yKey) ?? [])].sort((a, b) => a.x0 - b.x0);
    if (!rowWords.length) continue;

    const firstX0 = rowWords[0].x0;
    const lastX1 = rowWords[rowWords.length - 1].x1;
    const lineWidth = lastX1 - firstX0;
    const combinedText = rowWords.map((w) => w.text).join(" ");

    const xGroups: number[] = [];
    for (const x of rowWords.map((w) => w.x0).sort((a, b) => a - b)) {
      if (!xGroups.length || x - xGroups[xGroups.length - 1] > 50) xGroups.push(x);
    }

    const isParagraph = lineWidth > pageWidth * 0.55 && combinedText.length > 60;
    const firstWord = rowWords[0].text.trim();
    const hasPartialNumbering = PARTIAL_NUMBERING_PATTERN.test(firstWord);

    rowInfo.push({
      words: rowWords,
      text: combinedText,
      xGroups,
      isParagraph,
      numColumns: xGroups.length,
      hasPartialNumbering,
    });
  }

  const allTableX: number[] = [];
  for (const info of rowInfo) {
    if (info.numColumns >= 3 && !info.isParagraph) {
      allTableX.push(...info.xGroups);
    }
  }

  if (!allTableX.length) return null;

  allTableX.sort((a, b) => a - b);
  const gaps = allTableX
    .slice(1)
    .map((x, i) => x - allTableX[i])
    .filter((g) => g > 5);

  let adaptiveTolerance = 35;
  if (gaps.length >= 3) {
    const sorted = [...gaps].sort((a, b) => a - b);
    adaptiveTolerance = sorted[Math.floor(sorted.length * 0.7)];
    adaptiveTolerance = Math.max(25, Math.min(50, adaptiveTolerance));
  }

  const globalColumns: number[] = [];
  for (const x of allTableX) {
    if (!globalColumns.length || x - globalColumns[globalColumns.length - 1] > adaptiveTolerance) {
      globalColumns.push(x);
    }
  }

  if (globalColumns.length > 1) {
    const contentWidth = globalColumns[globalColumns.length - 1] - globalColumns[0];
    const avgColWidth = contentWidth / globalColumns.length;
    if (avgColWidth < 30) return null;

    const columnsPerInch = globalColumns.length / (contentWidth / 72);
    if (columnsPerInch > 10) return null;

    const adaptiveMax = Math.max(15, Math.floor(20 * (pageWidth / 612)));
    if (globalColumns.length > adaptiveMax) return null;
  } else {
    return null;
  }

  const numCols = globalColumns.length;

  for (const info of rowInfo) {
    if (info.isParagraph || info.hasPartialNumbering) {
      info.isTableRow = false;
      continue;
    }

    const aligned = new Set<number>();
    for (const word of info.words) {
      for (let colIdx = 0; colIdx < globalColumns.length; colIdx++) {
        if (Math.abs(word.x0 - globalColumns[colIdx]) < 40) {
          aligned.add(colIdx);
          break;
        }
      }
    }
    info.isTableRow = aligned.size >= 2;
  }

  const tableRegions: Array<[number, number]> = [];
  let i = 0;
  while (i < rowInfo.length) {
    if (rowInfo[i].isTableRow) {
      const start = i;
      while (i < rowInfo.length && rowInfo[i].isTableRow) i++;
      tableRegions.push([start, i]);
    } else {
      i++;
    }
  }

  const totalTableRows = tableRegions.reduce((sum, [s, e]) => sum + (e - s), 0);
  if (rowInfo.length > 0 && totalTableRows / rowInfo.length < 0.2) return null;

  const extractCells = (info: RowInfo): string[] => {
    const cells = Array.from({ length: numCols }, () => "");
    for (const word of info.words) {
      let assignedCol = numCols - 1;
      for (let colIdx = 0; colIdx < numCols - 1; colIdx++) {
        if (word.x0 < globalColumns[colIdx + 1] - 20) {
          assignedCol = colIdx;
          break;
        }
      }
      cells[assignedCol] = cells[assignedCol] ? `${cells[assignedCol]} ${word.text}` : word.text;
    }
    return cells;
  };

  const resultLines: string[] = [];
  let idx = 0;

  while (idx < rowInfo.length) {
    const region = tableRegions.find(([start]) => start === idx);
    if (region) {
      const [start, end] = region;
      const tableData = rowInfo.slice(start, end).map(extractCells);
      if (tableData.length) {
        const colWidths = Array.from({ length: numCols }, (_, col) =>
          Math.max(3, ...tableData.map((row) => (row[col] ?? "").length)),
        );
        const header = tableData[0];
        resultLines.push(
          "| " + header.map((cell, ci) => cell.padEnd(colWidths[ci])).join(" | ") + " |",
        );
        resultLines.push("| " + colWidths.map((w) => "-".repeat(w)).join(" | ") + " |");
        for (const row of tableData.slice(1)) {
          resultLines.push(
            "| " + row.map((cell, ci) => cell.padEnd(colWidths[ci])).join(" | ") + " |",
          );
        }
      }
      idx = end;
    } else {
      const inTable = tableRegions.some(([start, end]) => idx > start && idx < end);
      if (!inTable) resultLines.push(rowInfo[idx].text);
      idx++;
    }
  }

  return resultLines.join("\n");
}
