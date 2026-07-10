import mupdf from "mupdf";

export interface PageRenderInfo {
  pageIndex: number;
  pdfWidth: number;
  pdfHeight: number;
  renderWidth: number;
  renderHeight: number;
}

export function renderPdfPageDataUrl(
  bytes: Uint8Array,
  pageIndex: number,
  targetWidth: number,
): { dataUrl: string; info: PageRenderInfo } {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  try {
    const page = doc.loadPage(pageIndex);
    try {
      const bounds = page.getBounds();
      const pdfWidth = bounds[2]! - bounds[0]!;
      const pdfHeight = bounds[3]! - bounds[1]!;
      const scale = targetWidth / Math.max(1, pdfWidth);
      const matrix = mupdf.Matrix.scale(scale, scale);
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
      try {
        const png = pixmap.asPNG();
        const binary = Array.from(png, (b) => String.fromCharCode(b)).join("");
        const dataUrl = `data:image/png;base64,${btoa(binary)}`;
        return {
          dataUrl,
          info: {
            pageIndex,
            pdfWidth,
            pdfHeight,
            renderWidth: pixmap.getWidth(),
            renderHeight: pixmap.getHeight(),
          },
        };
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}
