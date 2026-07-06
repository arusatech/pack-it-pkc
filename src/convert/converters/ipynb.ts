import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { FileConversionError } from "../../types/exceptions.js";

const ACCEPTED_EXTENSIONS = [".ipynb"];
const CANDIDATE_MIME_PREFIXES = ["application/json"];

export class IpynbConverter implements DocumentConverter {
  accepts(stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext)) return true;

    const mime = (info.mimetype ?? "").toLowerCase();
    if (!CANDIDATE_MIME_PREFIXES.some((p) => mime.startsWith(p))) return false;

    const pos = stream.tell();
    try {
      const text = new TextDecoder(info.charset ?? "utf-8").decode(stream.remaining());
      return text.includes("nbformat") && text.includes("nbformat_minor");
    } finally {
      stream.seek(pos);
    }
  }

  convert(stream: ByteStream, info: StreamInfo): DocumentConverterResult {
    const encoding = info.charset ?? "utf-8";
    const text = new TextDecoder(encoding).decode(stream.remaining());
    try {
      const notebook = JSON.parse(text) as NotebookJson;
      return this.convertNotebook(notebook);
    } catch (err) {
      throw new FileConversionError([], `Error converting .ipynb: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private convertNotebook(notebook: NotebookJson): DocumentConverterResult {
    const mdOutput: string[] = [];
    let title: string | null = null;

    for (const cell of notebook.cells ?? []) {
      const source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source ?? "");
      if (cell.cell_type === "markdown") {
        mdOutput.push(source);
        if (!title) {
          const match = source.match(/^#\s+(.+)/m);
          if (match) title = match[1].trim();
        }
      } else if (cell.cell_type === "code") {
        mdOutput.push(`\`\`\`python\n${source}\n\`\`\``);
      } else if (cell.cell_type === "raw") {
        mdOutput.push(`\`\`\`\n${source}\n\`\`\``);
      }
    }

    title = (notebook.metadata?.title as string | undefined) ?? title;
    return { markdown: mdOutput.join("\n\n"), title };
  }
}

interface NotebookJson {
  cells?: Array<{ cell_type?: string; source?: string | string[] }>;
  metadata?: { title?: string };
}
