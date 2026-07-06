import chardet from "chardet";
import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";

const ACCEPTED_MIME_PREFIXES = ["text/csv", "application/csv"];
const ACCEPTED_EXTENSIONS = [".csv"];

export class CsvConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME_PREFIXES.some((p) => mime.startsWith(p));
  }

  convert(stream: ByteStream, info: StreamInfo): DocumentConverterResult {
    const bytes = stream.remaining();
    let content: string;
    if (info.charset) {
      content = new TextDecoder(info.charset).decode(bytes);
    } else {
      const detected = chardet.detect(Buffer.from(bytes));
      content = new TextDecoder(typeof detected === "string" ? detected : "utf-8").decode(bytes);
    }

    const rows = parseCsv(content);
    if (rows.length === 0) return { markdown: "" };

    const header = rows[0];
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...rows.slice(1).map((row) => {
        const padded = [...row];
        while (padded.length < header.length) padded.push("");
        return `| ${padded.slice(0, header.length).join(" | ")} |`;
      }),
    ];
    return { markdown: lines.join("\n") };
  }
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.length > 0));
}
