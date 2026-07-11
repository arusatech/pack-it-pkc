import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { ConverterContext, DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { MissingDependencyError } from "../../types/exceptions.js";
import { toBase64 } from "../../utils/binary.js";

const ACCEPTED_MIME_PREFIXES = [
  "application/vnd.openxmlformats-officedocument.presentationml",
];
const ACCEPTED_EXTENSIONS = [".pptx"];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
});

export class PptxConverter implements DocumentConverter {
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
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(stream.remaining());
    } catch {
      throw new MissingDependencyError("PptxConverter", "jszip");
    }

    const slidePaths = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
      .sort((a, b) => slideNumber(a) - slideNumber(b));

    const sections: string[] = [];

    for (let i = 0; i < slidePaths.length; i++) {
      const slidePath = slidePaths[i];
      const slideXml = await zip.file(slidePath)?.async("string");
      if (!slideXml) continue;

      const slideNum = i + 1;
      const parts: string[] = [`\n\n<!-- Slide number: ${slideNum} -->`];

      const doc = xmlParser.parse(slideXml);
      const texts = extractTextRuns(doc);
      const tables = extractTables(doc);

      if (texts.length > 0) {
        parts.push(`# ${texts[0]}`);
        if (texts.length > 1) {
          parts.push(texts.slice(1).join("\n"));
        }
      }

      for (const table of tables) {
        parts.push(table);
      }

      const images = await extractSlideImages(zip, slidePath, slideXml, ctx);
      parts.push(...images);

      const notesPath = slidePath.replace("/slides/", "/notesSlides/").replace("slide", "notesSlide");
      const notesXml = await zip.file(notesPath)?.async("string");
      if (notesXml) {
        const notesDoc = xmlParser.parse(notesXml);
        const notesText = extractTextRuns(notesDoc).join("\n").trim();
        if (notesText) {
          parts.push("\n\n### Notes:\n", notesText);
        }
      }

      sections.push(parts.join("\n").trim());
    }

    return { markdown: sections.join("\n\n").trim() };
  }
}

function slideNumber(path: string): number {
  const m = /slide(\d+)\.xml$/i.exec(path);
  return m ? Number(m[1]) : 0;
}

function extractTextRuns(node: unknown): string[] {
  const texts: string[] = [];
  walk(node, (n) => {
    if (n && typeof n === "object" && "t" in n && typeof (n as { t: unknown }).t === "string") {
      const t = (n as { t: string }).t.trim();
      if (t) texts.push(t);
    }
  });
  return texts;
}

function extractTables(node: unknown): string[] {
  const tables: string[] = [];
  walk(node, (n) => {
    if (!n || typeof n !== "object" || !("tbl" in n)) return;
    const tbl = (n as { tbl: unknown }).tbl;
    const rows = normalizeArray(
      (tbl as { tr?: unknown }).tr ?? (tbl as { row?: unknown }).row,
    );
    if (rows.length === 0) return;

    const mdRows: string[][] = [];
    for (const row of rows) {
      const cells = normalizeArray((row as { tc?: unknown }).tc);
      const mdCells: string[] = [];
      for (const cell of cells) {
        const cellText = extractTextRuns(cell).join(" ");
        mdCells.push(escapeCell(cellText));
      }
      mdRows.push(mdCells);
    }

    if (mdRows.length === 0) return;

    const header = mdRows[0];
    const sep = header.map(() => "---");
    const body = mdRows.slice(1);
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${sep.join(" | ")} |`,
      ...body.map((r) => `| ${r.join(" | ")} |`),
    ];
    tables.push(lines.join("\n"));
  });
  return tables;
}

async function extractSlideImages(
  zip: JSZip,
  slidePath: string,
  slideXml: string,
  ctx?: ConverterContext,
): Promise<string[]> {
  const refs = [...slideXml.matchAll(/embed="([^"]+)"/g)].map((m) => m[1]);
  const lines: string[] = [];
  const provider = ctx?.llmProvider;

  for (const relId of refs) {
    const relsPath = "ppt/slides/_rels/" + slidePath.split("/").pop() + ".rels";
    const relsXml = await zip.file(relsPath)?.async("string");
    if (!relsXml) continue;

    const targetMatch = new RegExp(`Id="${relId}"[^>]*Target="([^"]+)"`).exec(relsXml);
    if (!targetMatch) continue;

    const mediaPath = "ppt/" + targetMatch[1].replace(/^\.\.\//, "");
    const file = zip.file(mediaPath);
    if (!file) continue;

    const bytes = new Uint8Array(await file.async("arraybuffer"));
    const filename = mediaPath.split("/").pop() ?? "image";
    const mime = guessImageMime(filename);

    let alt = filename;
    if (provider?.describeImage) {
      const caption = await provider.describeImage({
        bytes,
        mimeType: mime,
        prompt: ctx?.llmPrompt ?? "Describe this slide image.",
        model: ctx?.llmModel,
      });
      if (caption) alt = caption.replace(/[\r\n\[\]]/g, " ").trim();
    }

    if (ctx?.keepDataUris) {
      const b64 = toBase64(bytes);
      lines.push(`\n![${alt}](data:${mime};base64,${b64})\n`);
    } else {
      lines.push(`\n![${alt}](${filename})\n`);
    }
  }

  return lines;
}

function guessImageMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function walk(node: unknown, visit: (n: unknown) => void): void {
  visit(node);
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  for (const value of Object.values(node)) {
    walk(value, visit);
  }
}
