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

/**
 * Re-render a PDF bbox at high DPI into a canvas (annadata DocCanvasRenderer.cropRegionToPng).
 * Avoids soft edges from cropping the on-screen preview raster.
 */
export function renderPdfBboxToCanvas(
  bytes: Uint8Array,
  pageIndex: number,
  bbox: { x: number; y: number; w: number; h: number },
  opts?: { maxEdge?: number; maxZoom?: number },
): HTMLCanvasElement {
  const maxEdge = opts?.maxEdge ?? 4096;
  const maxZoom = opts?.maxZoom ?? 5;
  // Prefer at least 3× (annadata IMAGE_BASE_ZOOM) so small-body text stays legible.
  const zoom = Math.min(maxZoom, Math.max(3, maxEdge / Math.max(bbox.w, bbox.h, 1)));
  const w = Math.max(1, Math.ceil(bbox.w * zoom));
  const h = Math.max(1, Math.ceil(bbox.h * zoom));

  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  try {
    const page = doc.loadPage(pageIndex);
    try {
      const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
      try {
        pixmap.clear(255);
        // Scale then translate so bbox top-left maps to (0,0).
        const ctm = [zoom, 0, 0, zoom, -bbox.x * zoom, -bbox.y * zoom] as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        const device = new mupdf.DrawDevice(ctm, pixmap);
        try {
          page.run(device, mupdf.Matrix.identity);
          device.close();
        } catch (err) {
          try {
            device.close();
          } catch {
            /* ignore */
          }
          throw err;
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");

        // DeviceRGB without alpha → 3 bytes/pixel; ImageData needs RGBA.
        const src = pixmap.getPixels();
        const comps = pixmap.getNumberOfComponents();
        const rgba = new Uint8ClampedArray(w * h * 4);
        if (comps === 4) {
          rgba.set(src);
        } else {
          for (let i = 0, p = 0; i < w * h; i++, p += comps) {
            rgba[i * 4] = src[p]!;
            rgba[i * 4 + 1] = src[p + 1] ?? src[p]!;
            rgba[i * 4 + 2] = src[p + 2] ?? src[p]!;
            rgba[i * 4 + 3] = 255;
          }
        }
        ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
        return canvas;
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
