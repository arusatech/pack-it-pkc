import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { ConverterContext, DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import type { MarkItDown } from "../mark-it-down.js";

const ACCEPTED_EXTENSIONS = [".zip"];
const ACCEPTED_MIME = ["application/zip", "application/x-zip-compressed"];

export class ZipConverter implements DocumentConverter {
  constructor(private readonly engine: Pick<MarkItDown, "convertBytes">) {}

  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
    return ACCEPTED_MIME.includes((info.mimetype ?? "").toLowerCase());
  }

  async convert(stream: ByteStream, info: StreamInfo, ctx?: ConverterContext): Promise<DocumentConverterResult> {
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(stream.remaining());
    const sections: string[] = [];

    for (const [name, data] of Object.entries(entries)) {
      if (name.endsWith("/")) continue;
      const inner = await this.engine.convertBytes(data, {
        filename: name,
        extension: extname(name),
        ...ctx,
      });
      sections.push(`## ${name}\n\n${inner.markdown}`);
    }

    return {
      markdown: sections.join("\n\n"),
      title: info.filename ?? "archive.zip",
    };
  }
}

function extname(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i) : "";
}
