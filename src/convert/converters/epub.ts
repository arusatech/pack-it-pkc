import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { ByteStream as BS } from "../../utils/byte-stream.js";
import { convertHtmlStringToMarkdown } from "../../utils/html-to-markdown.js";
import { HtmlConverter } from "../converters/html.js";

const ACCEPTED_MIME = ["application/epub", "application/epub+zip", "application/x-epub+zip"];
const ACCEPTED_EXT = [".epub"];
const MIME_MAP: Record<string, string> = { ".html": "text/html", ".xhtml": "application/xhtml+xml" };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export class EpubConverter implements DocumentConverter {
  private readonly html = new HtmlConverter();

  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXT.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME.some((p) => mime.startsWith(p));
  }

  async convert(stream: ByteStream): Promise<DocumentConverterResult> {
    const zip = await JSZip.loadAsync(stream.remaining());
    const containerXml = await zip.file("META-INF/container.xml")?.async("string");
    if (!containerXml) throw new Error("Invalid EPUB: missing container.xml");

    const container = parser.parse(containerXml);
    const opfPath =
      container?.container?.rootfiles?.rootfile?.["@_full-path"] ??
      container?.container?.rootfiles?.rootfile?.[0]?.["@_full-path"];
    if (!opfPath) throw new Error("Invalid EPUB: missing OPF path");

    const opfXml = await zip.file(opfPath)?.async("string");
    if (!opfXml) throw new Error("Invalid EPUB: missing OPF");

    const opf = parser.parse(opfXml);
    const metadata = extractMetadata(opf);
    const manifest = buildManifest(opf);
    const spine = buildSpine(opf, manifest, opfPath);

    const sections: string[] = [];
    for (const file of spine) {
      const entry = zip.file(file);
      if (!entry) continue;
      const bytes = new Uint8Array(await entry.async("arraybuffer"));
      const filename = file.split("/").pop() ?? file;
      const ext = filename.includes(".") ? `.${filename.split(".").pop()}` : "";
      const result = await this.html.convert(BS.fromBuffer(bytes), {
        mimetype: MIME_MAP[ext.toLowerCase()] ?? "text/html",
        extension: ext,
        filename,
      });
      if (result.markdown.trim()) sections.push(result.markdown.trim());
    }

    const metaLines = Object.entries(metadata)
      .filter(([, v]) => v)
      .map(([k, v]) => `**${k.charAt(0).toUpperCase() + k.slice(1)}:** ${Array.isArray(v) ? v.join(", ") : v}`);

    return {
      markdown: [...metaLines, ...sections].join("\n\n"),
      title: (metadata.title as string) ?? null,
    };
  }
}

function extractMetadata(opf: Record<string, unknown>): Record<string, string | string[]> {
  const md = (opf as { package?: { metadata?: Record<string, unknown> } }).package?.metadata ?? {};
  const get = (key: string) => {
    const val = md[key] ?? md[`dc:${key}`];
    if (Array.isArray(val)) return val.map(textOf);
    if (val && typeof val === "object") return textOf(val);
    return typeof val === "string" ? val : undefined;
  };
  return {
    title: get("title"),
    authors: get("creator") ? [String(get("creator"))] : [],
    language: get("language"),
    publisher: get("publisher"),
    date: get("date"),
    description: get("description"),
    identifier: get("identifier"),
  } as Record<string, string | string[]>;
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "#text" in node) return String((node as { "#text": string })["#text"]);
  return String(node);
}

function buildManifest(opf: Record<string, unknown>): Record<string, string> {
  const items = (opf as { package?: { manifest?: { item?: unknown } } }).package?.manifest?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  const manifest: Record<string, string> = {};
  for (const item of list) {
    const rec = item as { "@_id"?: string; "@_href"?: string };
    if (rec["@_id"] && rec["@_href"]) manifest[rec["@_id"]] = rec["@_href"];
  }
  return manifest;
}

function buildSpine(opf: Record<string, unknown>, manifest: Record<string, string>, opfPath: string): string[] {
  const base = opfPath.includes("/") ? opfPath.split("/").slice(0, -1).join("/") : "";
  const items = (opf as { package?: { spine?: { itemref?: unknown } } }).package?.spine?.itemref;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return list
    .map((item) => (item as { "@_idref"?: string })["@_idref"])
    .filter((id): id is string => !!id && !!manifest[id])
    .map((id) => (base ? `${base}/${manifest[id]}` : manifest[id]));
}
