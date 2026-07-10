import type { Page, Quad } from "mupdf";
import type { PdfPageLike, PdfWord } from "./pdf-word-types.js";

function quadBounds(quad: Quad): { x0: number; x1: number; top: number; bottom: number } {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/** Map a MuPDF page to positioned words for form/table heuristics. */
export function pageToWords(page: Page): PdfPageLike {
  const bounds = page.getBounds();
  const pageWidth = bounds[2] - bounds[0];

  const words: PdfWord[] = [];
  let current = "";
  let x0 = 0;
  let x1 = 0;
  let top = 0;
  let bottom = 0;

  const flush = () => {
    const text = current.trim();
    if (text) words.push({ text, x0, x1, top, bottom });
    current = "";
  };

  const stext = page.toStructuredText("preserve-whitespace");
  try {
    stext.walk({
      onChar(c: string, _origin, _font, _size, quad) {
        if (/\s/.test(c)) {
          flush();
          return;
        }
        const b = quadBounds(quad);
        if (!current) {
          x0 = b.x0;
          top = b.top;
          bottom = b.bottom;
        }
        x1 = b.x1;
        bottom = Math.max(bottom, b.bottom);
        current += c;
      },
      endLine() {
        flush();
      },
    });
  } finally {
    stext.destroy();
  }

  return { width: pageWidth, words };
}
