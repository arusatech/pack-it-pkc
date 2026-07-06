import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { ConverterContext, DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { MissingDependencyError } from "../../types/exceptions.js";

const ACCEPTED_EXTENSIONS = [".pdf"];
const ACCEPTED_MIME = ["application/pdf"];

export class PdfConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
    return ACCEPTED_MIME.includes((info.mimetype ?? "").toLowerCase());
  }

  async convert(stream: ByteStream, _info: StreamInfo, ctx?: ConverterContext): Promise<DocumentConverterResult> {
    let pdfParse: (buf: Buffer) => Promise<{ text: string; info?: { Title?: string } }>;
    try {
      const mod = await import("pdf-parse");
      pdfParse = (mod.default ?? mod) as typeof pdfParse;
    } catch {
      throw new MissingDependencyError("PdfConverter", "pdf-parse");
    }

    const result = await pdfParse(Buffer.from(stream.remaining()));

    // Optional GGUF vision/OCR pass when text extraction is sparse
    const provider = ctx?.llmProvider;
    if (provider && result.text.trim().length < 50) {
      const caption = await provider.describeDocument?.({
        bytes: stream.toUint8Array(),
        mimeType: "application/pdf",
        prompt: ctx?.llmPrompt ?? "Extract all readable text from this document.",
        model: ctx?.llmModel,
      });
      if (caption) {
        return { markdown: caption, title: result.info?.Title ?? null };
      }
    }

    return { markdown: result.text, title: result.info?.Title ?? null };
  }
}
