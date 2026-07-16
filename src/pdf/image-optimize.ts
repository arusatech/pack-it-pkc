/**
 * Compact tagged-region images: trim margins, refine edges, denoise, WebP/JPEG encode.
 * Adapted from annadata-app `rasterRegionEnhance` + sharper region crops.
 */

export type ImageEnhanceMode = "document" | "photo" | "auto";

export interface OptimizeRasterOptions {
  /** Enhancement mode. `document` = B&W Otsu; `photo` = keep colour, bleach background. */
  mode?: ImageEnhanceMode;
  /** Prefer colour when mode is `auto` (maps to photo). Default false → document. */
  colorMode?: boolean;
  /** Max edge length in px before uniform downscale (default 2000 for sharper figures). */
  maxEdge?: number;
  /** WebP quality 0–1 (default 0.88). */
  webpQuality?: number;
  /** JPEG fallback quality 0–1 (default 0.9). */
  jpegQuality?: number;
  /** Auto-crop near-white margins (default true). */
  trimMargins?: boolean;
  /** Sharpen / morphologically clean edges after enhance (default true). */
  refineEdges?: boolean;
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
 * Document: morphological open (drop speckles) then close (solidify stroke edges).
 * Photo: mild unsharp mask for crisper figure boundaries.
 */
function refineEdges(imageData: ImageData, mode: ImageEnhanceMode): ImageData {
  if (mode === "photo") return unsharpMask(imageData, 0.45);
  return morphOpenCloseBinary(imageData);
}

function morphOpenCloseBinary(imageData: ImageData): ImageData {
  const { width, height, data } = imageData;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) {
    ink[i] = data[i * 4]! < 128 ? 1 : 0;
  }

  const erode = (src: Uint8Array): Uint8Array => {
    const dst = new Uint8Array(src.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let keep = 1;
        for (let dy = -1; dy <= 1 && keep; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!src[(y + dy) * width + (x + dx)]!) {
              keep = 0;
              break;
            }
          }
        }
        dst[y * width + x] = keep;
      }
    }
    return dst;
  };

  const dilate = (src: Uint8Array): Uint8Array => {
    const dst = new Uint8Array(src.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let any = 0;
        for (let dy = -1; dy <= 1 && !any; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (src[(y + dy) * width + (x + dx)]!) {
              any = 1;
              break;
            }
          }
        }
        dst[y * width + x] = any;
      }
    }
    return dst;
  };

  // Open then close
  let m = dilate(erode(ink));
  m = erode(dilate(m));

  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < m.length; i++) {
    const v = m[i]! ? 0 : 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
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
 * Downscale + trim margins + refine edges + encode as WebP (JPEG fallback).
 */
export async function optimizeImageCanvasToDataUrl(
  source: HTMLCanvasElement,
  options: OptimizeRasterOptions = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  const mode: ImageEnhanceMode =
    options.mode ?? (options.colorMode ? "photo" : "document");
  const maxEdge = options.maxEdge ?? 2000;
  const webpQ = options.webpQuality ?? 0.88;
  const jpegQ = options.jpegQuality ?? 0.9;
  const trimMargins = options.trimMargins !== false;
  const doRefine = options.refineEdges !== false;

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

  // High-quality resampling when downscaling from hi-DPI PDF crop.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);

  try {
    let imageData = ctx.getImageData(0, 0, width, height);
    imageData = mode === "photo" ? applyPhotoMode(imageData) : applyDocumentMode(imageData);
    if (trimMargins) imageData = trimContentMargins(imageData, 6);
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
