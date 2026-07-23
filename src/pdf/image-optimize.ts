/**
 * Compact tagged-region images: trim margins, sharpen text, encode.
 * Document regions prefer lossless PNG so glyph edges stay crisp.
 */

export type ImageEnhanceMode = "document" | "photo" | "auto";

export interface OptimizeRasterOptions {
  /** Enhancement mode. `document` = B&W Otsu; `photo` = keep colour, bleach background. */
  mode?: ImageEnhanceMode;
  /** Prefer colour when mode is `auto` (maps to photo). Default false → document. */
  colorMode?: boolean;
  /** Max edge length in px before uniform downscale (default 3200 for sharper figures). */
  maxEdge?: number;
  /** WebP quality 0–1 when lossy encode is used (default 0.95). */
  webpQuality?: number;
  /** JPEG fallback quality 0–1 (default 0.95). */
  jpegQuality?: number;
  /** Auto-crop near-white margins (default true). */
  trimMargins?: boolean;
  /**
   * Post-enhance sharpen / clean. For document mode this is a mild unsharp
   * (morph open/close was dropping thin glyph strokes). Default true.
   */
  refineEdges?: boolean;
  /**
   * Prefer lossless PNG for document/B&W output (default true for document).
   * Lossy WebP/JPEG softens small text badly.
   */
  preferLossless?: boolean;
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

/** Stretch greyscale so ink / paper use the full 0–255 range (helps faint PDF text). */
function stretchGrey(grey: Uint8Array): Uint8Array {
  let min = 255;
  let max = 0;
  for (let i = 0; i < grey.length; i++) {
    const v = grey[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  // Ignore nearly flat images
  if (range < 8) return grey;
  const out = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i++) {
    out[i] = Math.round(((grey[i]! - min) / range) * 255);
  }
  return out;
}

/**
 * Unsharp on greyscale buffer (amount typically 0.5–1.0).
 * Applied before Otsu so soft anti-aliased glyphs become crisper ink.
 */
function unsharpGrey(grey: Uint8Array, width: number, height: number, amount: number): Uint8Array {
  const blurred = boxBlurGrey(grey, width, height);
  const out = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i++) {
    const v = grey[i]! + amount * (grey[i]! - blurred[i]!);
    out[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return out;
}

function boxBlurGrey(grey: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(grey.length);
  out.set(grey);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += grey[(y + dy) * width + (x + dx)]!;
        }
      }
      out[y * width + x] = Math.round(sum / 9);
    }
  }
  return out;
}

/**
 * Greyscale → contrast stretch → mild unsharp → Otsu B&W.
 * Keeps thin strokes; does not morphologically erode glyphs.
 */
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

  const stretched = stretchGrey(grey);
  const sharp = unsharpGrey(stretched, width, height, 0.85);
  // Bias threshold slightly toward white so faint anti-aliased edges stay ink.
  const thresh = Math.min(250, otsuThreshold(sharp) + 8);

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = sharp[i]! > thresh ? 255 : 0;
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
  const bgThresh = Math.min(250, otsuThreshold(lumaArr) + 6);

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

/** Crop away near-white margins so figure edges sit cleanly in the frame. */
function trimContentMargins(imageData: ImageData, pad = 4): ImageData {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      // Near-white paper / watermark margin
      if (r > 248 && g > 248 && b > 248) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return imageData;

  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  if (tw >= width - 2 && th >= height - 2) return imageData;

  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const si = ((minY + y) * width + (minX + x)) * 4;
      const di = (y * tw + x) * 4;
      out[di] = data[si]!;
      out[di + 1] = data[si + 1]!;
      out[di + 2] = data[si + 2]!;
      out[di + 3] = data[si + 3]!;
    }
  }
  return new ImageData(out, tw, th);
}

/**
 * Document: light unsharp on binary edges (no morph — morph ate thin text).
 * Photo: stronger unsharp for figure boundaries.
 */
function refineEdges(imageData: ImageData, mode: ImageEnhanceMode): ImageData {
  if (mode === "photo") return unsharpMask(imageData, 0.55);
  // Binary document: optional 1px ink cleanup only (remove isolated speckles).
  return removeIsolatedInkSpeckles(imageData);
}

/** Drop lone black pixels that are fully surrounded by white (noise), keep strokes. */
function removeIsolatedInkSpeckles(imageData: ImageData): ImageData {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      if (data[i]! >= 128) continue; // already white
      let whiteN = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (data[((y + dy) * width + (x + dx)) * 4]! >= 128) whiteN++;
        }
      }
      // Only wipe truly isolated speckles (all 8 neighbors white)
      if (whiteN === 8) {
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
      }
    }
  }
  return new ImageData(out, width, height);
}

function unsharpMask(imageData: ImageData, amount: number): ImageData {
  const { width, height, data } = imageData;
  const blurred = boxBlur3(data, width, height);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const src = data[i + c]!;
      const blur = blurred[i + c]!;
      out[i + c] = Math.max(0, Math.min(255, Math.round(src + amount * (src - blur))));
    }
    out[i + 3] = 255;
  }
  return new ImageData(out, width, height);
}

function boxBlur3(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  out.set(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += data[((y + dy) * width + (x + dx)) * 4 + c]!;
          }
        }
        out[(y * width + x) * 4 + c] = Math.round(sum / 9);
      }
    }
  }
  return out;
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
 * Enhance + optionally downscale + encode.
 * Document mode defaults to lossless PNG so text stays sharp.
 */
export async function optimizeImageCanvasToDataUrl(
  source: HTMLCanvasElement,
  options: OptimizeRasterOptions = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  const mode: ImageEnhanceMode =
    options.mode ?? (options.colorMode ? "photo" : "document");
  const maxEdge = options.maxEdge ?? 3200;
  const webpQ = options.webpQuality ?? 0.95;
  const jpegQ = options.jpegQuality ?? 0.95;
  const trimMargins = options.trimMargins !== false;
  const doRefine = options.refineEdges !== false;
  const preferLossless = options.preferLossless ?? mode !== "photo";

  let width = source.width;
  let height = source.height;
  if (width < 1 || height < 1) {
    return { dataUrl: source.toDataURL("image/png"), width, height };
  }

  const needsDownscale = width > maxEdge || height > maxEdge;
  if (needsDownscale) {
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
      dataUrl: source.toDataURL(preferLossless ? "image/png" : "image/jpeg", jpegQ),
      width: source.width,
      height: source.height,
    };
  }

  // High-quality resample only when we must shrink; otherwise 1:1 copy.
  if (needsDownscale) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  } else {
    ctx.imageSmoothingEnabled = false;
  }
  ctx.drawImage(source, 0, 0, width, height);

  try {
    let imageData = ctx.getImageData(0, 0, width, height);
    imageData = mode === "photo" ? applyPhotoMode(imageData) : applyDocumentMode(imageData);
    if (trimMargins) imageData = trimContentMargins(imageData, 4);
    if (doRefine) imageData = refineEdges(imageData, mode);

    if (imageData.width !== canvas.width || imageData.height !== canvas.height) {
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      width = imageData.width;
      height = imageData.height;
    }
    ctx.putImageData(imageData, 0, 0);
  } catch (err) {
    console.warn("[image-optimize] enhance skipped", err);
  }

  // Lossless PNG for document/B&W — lossy codecs blur small glyph edges.
  if (preferLossless) {
    try {
      const png = await canvasToBlob(canvas, "image/png");
      if (png && png.size > 0) {
        return { dataUrl: await readBlobAsDataUrl(png), width, height };
      }
    } catch (err) {
      console.warn("[image-optimize] png encode skipped", err);
    }
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width,
      height,
    };
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
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
  };
}
