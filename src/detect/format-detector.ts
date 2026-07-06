import chardet from "chardet";
import type { StreamInfo } from "../types/stream-info.js";
import { copyAndUpdate } from "../types/stream-info.js";
import type { ByteStream } from "../utils/byte-stream.js";
import {
  detectFromMagicBytes,
  guessExtensionFromMime,
  guessMimeFromExtension,
  isLikelyText,
} from "./magic-bytes.js";

export interface FormatGuess extends StreamInfo {
  isText?: boolean;
}

/**
 * Content-based format detection without ONNX/Magika.
 * Uses magic bytes, extension/MIME cross-inference, and charset heuristics.
 */
export async function guessStreamFormats(
  stream: ByteStream,
  baseGuess: StreamInfo,
): Promise<FormatGuess[]> {
  const enhanced = copyAndUpdate(baseGuess);

  if (!enhanced.mimetype && enhanced.extension) {
    enhanced.mimetype = guessMimeFromExtension(enhanced.extension);
  }
  if (!enhanced.extension && enhanced.mimetype) {
    enhanced.extension = guessExtensionFromMime(enhanced.mimetype);
  }

  const pos = stream.tell();
  const head = stream.read(Math.min(8192, stream.length - pos));
  stream.seek(pos);

  let magicGuess = detectFromMagicBytes(head);

  // file-type for additional coverage (Node / bundlers with dynamic import)
  if (!magicGuess) {
    try {
      const { fileTypeFromBuffer } = await import("file-type");
      const ft = await fileTypeFromBuffer(head);
      if (ft) {
        magicGuess = { ext: `.${ft.ext}`, mime: ft.mime };
      }
    } catch {
      // file-type unavailable in some runtimes
    }
  }

  let charset: string | null = enhanced.charset ?? null;
  const textLike = magicGuess ? isTextMime(magicGuess.mime) : isLikelyText(head);
  if (textLike && !charset) {
    const detected = chardet.detect(Buffer.from(head));
    if (typeof detected === "string") charset = normalizeCharset(detected);
  }

  const guesses: FormatGuess[] = [];

  if (magicGuess) {
    const compatible = isCompatible(baseGuess, magicGuess.mime, magicGuess.ext, charset);
    if (compatible) {
      guesses.push({
        mimetype: baseGuess.mimetype ?? magicGuess.mime,
        extension: baseGuess.extension ?? magicGuess.ext,
        charset: baseGuess.charset ?? charset,
        filename: baseGuess.filename,
        localPath: baseGuess.localPath,
        url: baseGuess.url,
        isText: textLike,
      });
    } else {
      guesses.push({ ...enhanced, isText: textLike });
      guesses.push({
        mimetype: magicGuess.mime,
        extension: magicGuess.ext,
        charset,
        filename: baseGuess.filename,
        localPath: baseGuess.localPath,
        url: baseGuess.url,
        isText: textLike,
      });
    }
  } else {
    guesses.push({ ...enhanced, charset: enhanced.charset ?? charset, isText: textLike });
  }

  return guesses;
}

function isCompatible(
  base: StreamInfo,
  guessedMime: string,
  guessedExt: string,
  guessedCharset: string | null,
): boolean {
  if (base.mimetype && base.mimetype !== guessedMime) return false;
  if (base.extension) {
    const ext = base.extension.startsWith(".") ? base.extension.slice(1) : base.extension;
    const guessed = guessedExt.startsWith(".") ? guessedExt.slice(1) : guessedExt;
    if (ext !== guessed) return false;
  }
  if (base.charset && guessedCharset && normalizeCharset(base.charset) !== guessedCharset) {
    return false;
  }
  return true;
}

function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || mime.includes("json") || mime.includes("xml");
}

function normalizeCharset(charset: string): string {
  return charset.toLowerCase().replace("iso-8859-1", "latin1");
}
