/** Magic-byte signatures for common document formats (replaces Magika ONNX model). */
export const MAGIC_SIGNATURES: Array<{
  ext: string;
  mime: string;
  match: (bytes: Uint8Array) => boolean;
}> = [
  {
    ext: ".pdf",
    mime: "application/pdf",
    match: (b) => b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  },
  {
    ext: ".zip",
    mime: "application/zip",
    match: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
  {
    ext: ".docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    match: (b) =>
      b.length >= 4 &&
      b[0] === 0x50 &&
      b[1] === 0x4b &&
      b[2] === 0x03 &&
      b[3] === 0x04,
  },
  {
    ext: ".xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    match: (b) =>
      b.length >= 4 &&
      b[0] === 0x50 &&
      b[1] === 0x4b &&
      b[2] === 0x03 &&
      b[3] === 0x04,
  },
  {
    ext: ".pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    match: (b) =>
      b.length >= 4 &&
      b[0] === 0x50 &&
      b[1] === 0x4b &&
      b[2] === 0x03 &&
      b[3] === 0x04,
  },
  {
    ext: ".png",
    mime: "image/png",
    match: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    ext: ".jpg",
    mime: "image/jpeg",
    match: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: ".gif",
    mime: "image/gif",
    match: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) &&
      b[5] === 0x61,
  },
  {
    ext: ".html",
    mime: "text/html",
    match: (b) => {
      const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 256)).trimStart().toLowerCase();
      return head.startsWith("<!doctype html") || head.startsWith("<html");
    },
  },
  {
    ext: ".json",
    mime: "application/json",
    match: (b) => {
      const c = b[0];
      return c === 0x7b || c === 0x5b; // { or [
    },
  },
];

export const EXTENSION_MIME: Record<string, string> = {
  ".txt": "text/plain",
  ".text": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".json": "application/json",
  ".jsonl": "application/jsonl",
  ".ipynb": "application/json",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".epub": "application/epub+zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};

export function guessMimeFromExtension(ext: string): string | null {
  const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return EXTENSION_MIME[normalized] ?? null;
}

export function guessExtensionFromMime(mime: string): string | null {
  const lower = mime.toLowerCase();
  for (const [ext, m] of Object.entries(EXTENSION_MIME)) {
    if (m === lower) return ext;
  }
  return null;
}

export function detectFromMagicBytes(bytes: Uint8Array): { ext: string; mime: string } | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.match(bytes)) return { ext: sig.ext, mime: sig.mime };
  }
  return null;
}

export function isLikelyText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let nonText = 0;
  for (const b of sample) {
    if (b === 0 || (b < 9 && b !== 0x0a && b !== 0x0d && b !== 0x09)) {
      nonText++;
    }
  }
  return nonText / sample.length < 0.01;
}
