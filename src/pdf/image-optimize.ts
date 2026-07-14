/**
 * Compact tagged-region images: optional denoise / background cleanup + WebP/JPEG encode.
 * Adapted from annadata-app `rasterRegionEnhance` + `rasterImageEncode` (Canvas 2D, no OpenCV).
 */

export type ImageEnhanceMode = "document" | "photo" | "auto";

export interface OptimizeRasterOptions {
  /** Enhancement mode. `document` = B&W Otsu (smallest); `photo` = keep colour, bleach background. */
  mode?: ImageEnhanceMode;
  /** Prefer colour when mode is `auto` (maps to photo). Default false → document. */
  colorMode?: boolean;
  /** Max edge length in px before uniform downscale (default 1600). */
  maxEdge?: number;
  /** WebP quality 0–1 (default 0.78). */
  webpQuality?: number;
  /** JPEG fallback quality 0–1 (default 0.82). */
  jpegQuality?: number;
}

function otsuThreshold(grey: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < grey.length; i++) hist[grey[i]!]!++;
  const total = grey.length;
  for (let i = 0; i < 256; i++) hist[i]! /= total;

  let sumB = 0;
  let wB = 0;
  let maximum = 0;
  let threshold = 0;
  let sum1 = 0;
  for (let i = 0; i < 256; i++) sum1 += i * hist[i]!;

  for (let i = 0; i < 256; i++) {
    wB += hist[i]!;
    if (wB === 0) continue;
    const wF = 1 - wB;
    if (wF === 0) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB;
    const mF = (sum1 - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maximum) {
      maximum = between;
      threshold = i;
    }
  }
  return threshold;
}

/** Greyscale + Otsu → clean B&W (removes light watermarks / paper noise). */
function applyDocumentMode(imageData: ImageData): ImageData {
  const { data, width, height } = imageData;
  const n = width * height;
  const grey = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    grey[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  const thresh = otsuThreshold(grey);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = grey[i]! > thresh ? 255 : 0;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return new ImageData(out, width, height);
}

/** Contrast stretch + light background → white (keeps diagram colours). */
function applyPhotoMode(imageData: ImageData): ImageData {
  const { data, width, height } = imageData;
  const n = width * height;

  let rMin = 255,
    rMax = 0,
    gMin = 255,
    gMax = 0,
    bMin = 255,
    bMax = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3]! < 10) continue;
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  const rRange = rMax - rMin || 1;
  const gRange = gMax - gMin || 1;
  const bRange = bMax - bMin || 1;

  const lumaArr = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.round(((data[i * 4]! - rMin) / rRange) * 255);
    const g = Math.round(((data[i * 4 + 1]! - gMin) / gRange) * 255);
    const b = Math.round(((data[i * 4 + 2]! - bMin) / bRange) * 255);
    lumaArr[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  const bgThresh = otsuThreshold(lumaArr);

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const r = Math.round(((data[i * 4]! - rMin) / rRange) * 255);
    const g = Math.round(((data[i * 4 + 1]! - gMin) / gRange) * 255);
    const b = Math.round(((data[i * 4 + 2]! - bMin) / bRange) * 255);
    if (lumaArr[i]! > bgThresh) {
      out[i * 4] = 255;
      out[i * 4 + 1] = 255;
      out[i * 4 + 2] = 255;
    } else {
      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
    }
    out[i * 4 + 3] = 255;
  }
  return new ImageData(out, width, height);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error("readAsDataURL failed"));
    fr.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Downscale + denoise/bleach background + encode as WebP (JPEG fallback) for small storage.
 * Returns original PNG data URL from canvas.toDataURL if encode fails.
 */
export async function optimizeImageCanvasToDataUrl(
  source: HTMLCanvasElement,
  options: OptimizeRasterOptions = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  const mode: ImageEnhanceMode =
    options.mode ?? (options.colorMode ? "photo" : "document");
  const maxEdge = options.maxEdge ?? 1600;
  const webpQ = options.webpQuality ?? 0.78;
  const jpegQ = options.jpegQuality ?? 0.82;

  let width = source.width;
  let height = source.height;
  if (width < 1 || height < 1) {
    return { dataUrl: source.toDataURL("image/png"), width, height };
  }

  if (width > maxEdge || height > maxEdge) {
    const s = Math.min(maxEdge / width, maxEdge / height);
    width = Math.max(1, Math.floor(width * s));
    height = Math.max(1, Math.floor(height * s));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      dataUrl: source.toDataURL("image/jpeg", jpegQ),
      width: source.width,
      height: source.height,
    };
  }

  ctx.drawImage(source, 0, 0, width, height);

  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const enhanced =
      mode === "photo" ? applyPhotoMode(imageData) : applyDocumentMode(imageData);
    ctx.putImageData(enhanced, 0, 0);
  } catch (err) {
    console.warn("[image-optimize] enhance skipped", err);
  }

  try {
    const webp = await canvasToBlob(canvas, "image/webp", webpQ);
    if (webp && webp.size > 0) {
      return { dataUrl: await readBlobAsDataUrl(webp), width, height };
    }
    const jpeg = await canvasToBlob(canvas, "image/jpeg", jpegQ);
    if (jpeg && jpeg.size > 0) {
      return { dataUrl: await readBlobAsDataUrl(jpeg), width, height };
    }
  } catch (err) {
    console.warn("[image-optimize] compress skipped", err);
  }

  return {
    dataUrl: canvas.toDataURL("image/jpeg", jpegQ),
    width,
    height,
  };
}
