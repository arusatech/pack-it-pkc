import * as cheerio from "cheerio";
import TurndownService from "turndown";
import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";

const ACCEPTED_MIME_PREFIXES = ["text/html", "application/xhtml"];
const ACCEPTED_EXTENSIONS = [".html", ".htm"];

export class HtmlConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME_PREFIXES.some((p) => mime.startsWith(p));
  }

  convert(stream: ByteStream, info: StreamInfo): DocumentConverterResult {
    const encoding = info.charset ?? "utf-8";
    const html = new TextDecoder(encoding).decode(stream.remaining());
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();

    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    turndown.addRule("skipDataUris", {
      filter: (node) => node.nodeName === "IMG" && (node.getAttribute("src") ?? "").startsWith("data:"),
      replacement: () => "[image]",
    });

    const bodyEl = $("body");
    const fragment = bodyEl.length > 0 ? cheerio.load(bodyEl.html() ?? "") : $;
    const htmlContent = fragment.root().html() ?? fragment.root().text();
    let markdown: string;
    try {
      markdown = turndown.turndown(htmlContent);
    } catch {
      markdown = fragment.root().text();
    }

    const title = $("title").first().text().trim() || null;
    return { markdown, title };
  }
}
