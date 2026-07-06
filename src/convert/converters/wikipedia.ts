import * as cheerio from "cheerio";
import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { convertHtmlStringToMarkdown } from "../../utils/html-to-markdown.js";

const ACCEPTED_MIME = ["text/html", "application/xhtml"];
const ACCEPTED_EXT = [".html", ".htm"];
const WIKI_URL = /^https?:\/\/[a-zA-Z]{2,3}\.wikipedia\.org\//;

export class WikipediaConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const url = info.url ?? "";
    if (!WIKI_URL.test(url)) return false;
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXT.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME.some((p) => mime.startsWith(p));
  }

  convert(stream: ByteStream, info: StreamInfo): DocumentConverterResult {
    const html = new TextDecoder(info.charset ?? "utf-8").decode(stream.remaining());
    const $ = cheerio.load(html);
    $("script, style").remove();

    const body = $("#mw-content-text");
    const titleEl = $(".mw-page-title-main").first().text().trim();
    const pageTitle = $("title").first().text().trim() || null;

    let markdown: string;
    let title: string | null = titleEl || pageTitle;

    if (body.length) {
      markdown = `# ${titleEl || "Wikipedia"}\n\n${convertHtmlStringToMarkdown(body.html() ?? "")}`;
    } else {
      markdown = convertHtmlStringToMarkdown($.html());
    }

    return { markdown, title };
  }
}
