import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { ConverterContext, DocumentConverter, DocumentConverterResult } from "../../types/converter.js";

const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const ACCEPTED_MIME_PREFIXES = ["image/"];

const DEFAULT_PROMPT = "Write a detailed caption describing this image for document indexing.";

export class ImageConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME_PREFIXES.some((p) => mime.startsWith(p));
  }

  async convert(stream: ByteStream, info: StreamInfo, ctx?: ConverterContext): Promise<DocumentConverterResult> {
    const bytes = stream.remaining();
    const mime = info.mimetype ?? guessImageMime(info.extension) ?? "image/png";
    const parts: string[] = [`![${info.filename ?? "image"}](data:${mime};base64,${toBase64(bytes)})`];

    const provider = ctx?.llmProvider;
    if (provider?.describeImage) {
      const caption = await provider.describeImage({
        bytes,
        mimeType: mime,
        prompt: ctx?.llmPrompt ?? DEFAULT_PROMPT,
        model: ctx?.llmModel,
      });
      if (caption) parts.push("", caption);
    }

    return { markdown: parts.join("\n"), title: info.filename ?? null };
  }
}

function guessImageMime(ext?: string | null): string | null {
  switch ((ext ?? "").toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
