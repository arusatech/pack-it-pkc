import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import chardet from "chardet";

const ACCEPTED_MIME_PREFIXES = ["text/", "application/json", "application/markdown"];
const ACCEPTED_EXTENSIONS = [".txt", ".text", ".md", ".markdown", ".json", ".jsonl"];

export class PlainTextConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    if (info.charset) return true;
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME_PREFIXES.some((p) => mime.startsWith(p));
  }

  convert(stream: ByteStream, info: StreamInfo): DocumentConverterResult {
    const bytes = stream.remaining();
    let text: string;
    if (info.charset) {
      text = new TextDecoder(info.charset).decode(bytes);
    } else {
      const detected = chardet.detect(Buffer.from(bytes));
      const encoding = typeof detected === "string" ? detected : "utf-8";
      text = new TextDecoder(encoding).decode(bytes);
    }
    return { markdown: text };
  }
}
