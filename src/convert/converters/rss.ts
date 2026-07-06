import { XMLParser } from "fast-xml-parser";
import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { convertHtmlStringToMarkdown } from "../../utils/html-to-markdown.js";

const PRECISE_MIME = ["application/rss", "application/rss+xml", "application/atom", "application/atom+xml"];
const PRECISE_EXT = [".rss", ".atom"];
const CANDIDATE_MIME = ["text/xml", "application/xml"];
const CANDIDATE_EXT = [".xml"];

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, attributeNamePrefix: "@_" });

export class RssConverter implements DocumentConverter {
  accepts(stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    const mime = (info.mimetype ?? "").toLowerCase();
    if (PRECISE_EXT.includes(ext)) return true;
    if (PRECISE_MIME.some((p) => mime.startsWith(p))) return true;
    if (CANDIDATE_EXT.includes(ext) || CANDIDATE_MIME.some((p) => mime.startsWith(p))) {
      return this.detectFeed(stream) !== null;
    }
    return false;
  }

  convert(stream: ByteStream): DocumentConverterResult {
    const xml = new TextDecoder().decode(stream.remaining());
    const doc = parser.parse(xml);
    const feedType = this.feedType(doc);
    if (feedType === "rss") return this.parseRss(doc);
    if (feedType === "atom") return this.parseAtom(doc);
    throw new Error("Unknown feed type");
  }

  private detectFeed(stream: ByteStream): string | null {
    const pos = stream.tell();
    try {
      const xml = new TextDecoder().decode(stream.remaining());
      return this.feedType(parser.parse(xml));
    } catch {
      return null;
    } finally {
      stream.seek(pos);
    }
  }

  private feedType(doc: Record<string, unknown>): string | null {
    if (doc.rss) return "rss";
    if (doc.feed && (doc.feed as { entry?: unknown }).entry) return "atom";
    return null;
  }

  private parseAtom(doc: Record<string, unknown>): DocumentConverterResult {
    const feed = doc.feed as Record<string, unknown>;
    const title = text(feed.title);
    let md = `# ${title}\n`;
    const subtitle = text(feed.subtitle);
    if (subtitle) md += `${subtitle}\n`;

    const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
    for (const entry of entries) {
      const e = entry as Record<string, unknown>;
      const entryTitle = text(e.title);
      if (entryTitle) md += `\n## ${entryTitle}\n`;
      const updated = text(e.updated);
      if (updated) md += `Updated on: ${updated}\n`;
      const summary = text(e.summary);
      if (summary) md += this.parseContent(summary);
      const content = text(e.content);
      if (content) md += this.parseContent(content);
    }

    return { markdown: md, title };
  }

  private parseRss(doc: Record<string, unknown>): DocumentConverterResult {
    const channel = ((doc.rss as { channel?: unknown }).channel ?? {}) as Record<string, unknown>;
    const channelTitle = text(channel.title);
    let md = channelTitle ? `# ${channelTitle}\n` : "";
    const description = text(channel.description);
    if (description) md += `${description}\n`;

    const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
    for (const item of items) {
      const it = item as Record<string, unknown>;
      const title = text(it.title);
      if (title) md += `\n## ${title}\n`;
      const pubDate = text(it.pubDate);
      if (pubDate) md += `Published on: ${pubDate}\n`;
      const desc = text(it.description);
      if (desc) md += this.parseContent(desc);
      const content = text((it as Record<string, string>)["content:encoded"] ?? it["content:encoded"]);
      if (content) md += this.parseContent(content);
    }

    return { markdown: md, title: channelTitle };
  }

  private parseContent(content: string): string {
    try {
      return convertHtmlStringToMarkdown(content);
    } catch {
      return content;
    }
  }
}

function text(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object" && node !== null && "#text" in node) return String((node as { "#text": string })["#text"]);
  return String(node);
}
