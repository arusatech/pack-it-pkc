import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { ConverterContext, DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { MissingDependencyError } from "../../types/exceptions.js";
import { extractPdfMarkdown } from "../pdf/pdf-extractor.js";

const ACCEPTED_EXTENSIONS = [".pdf"];
const ACCEPTED_MIME = ["application/pdf", "application/x-pdf"];

export class PdfConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
    return ACCEPTED_MIME.includes((info.mimetype ?? "").toLowerCase());
  }

  async convert(stream: ByteStream, _info: StreamInfo, ctx?: ConverterContext): Promise<DocumentConverterResult> {
    const bytes = stream.remaining();

    try {
      const result = await extractPdfMarkdown(bytes);

      const provider = ctx?.llmProvider;
      if (provider && result.markdown.trim().length < 50) {
        const caption = await provider.describeDocument?.({
          bytes,
          mimeType: "application/pdf",
          prompt: ctx?.llmPrompt ?? "Extract all readable text from this document.",
          model: ctx?.llmModel,
        });
        if (caption) {
          return { markdown: caption, title: result.title ?? null };
        }
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MissingDependencyError("PdfConverter", `mupdf (${message})`);
    }
  }
}
