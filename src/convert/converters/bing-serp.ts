import * as cheerio from "cheerio";
import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { convertHtmlStringToMarkdown } from "../../utils/html-to-markdown.js";

const ACCEPTED_MIME = ["text/html", "application/xhtml"];
const ACCEPTED_EXT = [".html", ".htm"];
const BING_SERP_URL = /^https:\/\/www\.bing\.com\/search\?q=/;

/** Decode Bing redirect URLs from the `u` query parameter (base64url with 2-char prefix). */
function decodeBingRedirectHref(href: string): string {
  try {
    const parsed = new URL(href, "https://www.bing.com");
    const u = parsed.searchParams.get("u");
    if (!u) return href;

    const padded = u.slice(2).trim() + "==";
    return Buffer.from(padded, "base64url").toString("utf-8");
  } catch {
    return href;
  }
}

function formatResultMarkdown(md: string): string {
  return md
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Handle Bing results pages (organic search results only).
 * Port of Python `BingSerpConverter`.
 */
export class BingSerpConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const url = info.url ?? "";
    if (!BING_SERP_URL.test(url)) return false;

    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXT.includes(ext)) return true;

    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME.some((p) => mime.startsWith(p));
  }

  convert(stream: ByteStream, info: StreamInfo): DocumentConverterResult {
    const url = info.url ?? "";
    const query = new URL(url).searchParams.get("q") ?? "";
    const html = new TextDecoder(info.charset ?? "utf-8").decode(stream.remaining());
    const $ = cheerio.load(html);

    $(".tptt").each((_, el) => {
      const $el = $(el);
      const text = $el.text();
      if (text) $el.text(`${text} `);
    });
    $(".algoSlug_icon").remove();

    const results: string[] = [];
    $(".b_algo").each((_, el) => {
      const block = cheerio.load($(el).html() ?? "");
      block("a[href]").each((__, a) => {
        const $a = block(a);
        const href = $a.attr("href");
        if (href) $a.attr("href", decodeBingRedirectHref(href));
      });

      const md = formatResultMarkdown(convertHtmlStringToMarkdown(block.root().html() ?? ""));
      if (md) results.push(md);
    });

    const markdown = `## A Bing search for '${query}' found the following results:\n\n${results.join("\n\n")}`;
    const title = $("title").first().text().trim() || null;

    return { markdown, title };
  }
}
