import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { ConverterContext, DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { MissingDependencyError } from "../../types/exceptions.js";
import { convertHtmlStringToMarkdown } from "../../utils/html-to-markdown.js";
import { preprocessDocx } from "../docx/pre-process.js";

const ACCEPTED_MIME_PREFIXES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const ACCEPTED_EXTENSIONS = [".docx"];

export class DocxConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME_PREFIXES.some((p) => mime.startsWith(p));
  }

  async convert(
    stream: ByteStream,
    _info: StreamInfo,
    ctx?: ConverterContext,
  ): Promise<DocumentConverterResult> {
    let mammoth: {
      convertToHtml: (
        input: { buffer: Buffer },
        options?: { styleMap?: string },
      ) => Promise<{ value: string }>;
    };
    try {
      mammoth = await import("mammoth");
    } catch {
      throw new MissingDependencyError("DocxConverter", "mammoth");
    }

    const styleMap = typeof ctx?.styleMap === "string" ? ctx.styleMap : undefined;
    const processed = await preprocessDocx(stream.remaining());
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(processed) },
      styleMap ? { styleMap } : undefined,
    );

    return { markdown: convertHtmlStringToMarkdown(result.value) };
  }
}
