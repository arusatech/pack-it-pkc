import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { MissingDependencyError } from "../../types/exceptions.js";
import { convertHtmlStringToMarkdown } from "../../utils/html-to-markdown.js";

const XLSX_MIME = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
const XLSX_EXT = [".xlsx"];
const XLS_MIME = ["application/vnd.ms-excel", "application/excel"];
const XLS_EXT = [".xls"];

type WorkSheet = import("xlsx").WorkSheet;

async function loadXlsx() {
  try {
    return await import("xlsx");
  } catch {
    throw new MissingDependencyError("SpreadsheetConverter", "xlsx");
  }
}

function sheetToMarkdown(XLSX: Awaited<ReturnType<typeof loadXlsx>>, sheet: WorkSheet): string {
  const html = XLSX.utils.sheet_to_html(sheet, { id: "sheet" });
  return convertHtmlStringToMarkdown(html).trim();
}

export class XlsxConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (XLSX_EXT.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return XLSX_MIME.some((p) => mime.startsWith(p));
  }

  async convert(stream: ByteStream): Promise<DocumentConverterResult> {
    const XLSX = await loadXlsx();
    const workbook = XLSX.read(stream.remaining(), { type: "array" });
    const sections: string[] = [];

    for (const name of workbook.SheetNames) {
      sections.push(`## ${name}`);
      sections.push(sheetToMarkdown(XLSX, workbook.Sheets[name]));
    }

    return { markdown: sections.join("\n\n").trim() };
  }
}

export class XlsConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (XLS_EXT.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return XLS_MIME.some((p) => mime.startsWith(p));
  }

  async convert(stream: ByteStream): Promise<DocumentConverterResult> {
    const XLSX = await loadXlsx();
    const workbook = XLSX.read(stream.remaining(), { type: "array" });
    const sections: string[] = [];

    for (const name of workbook.SheetNames) {
      sections.push(`## ${name}`);
      sections.push(sheetToMarkdown(XLSX, workbook.Sheets[name]));
    }

    return { markdown: sections.join("\n\n").trim() };
  }
}
