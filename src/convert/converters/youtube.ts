import * as cheerio from "cheerio";
import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { ConverterContext, DocumentConverter, DocumentConverterResult } from "../../types/converter.js";

const ACCEPTED_MIME = ["text/html", "application/xhtml"];
const ACCEPTED_EXT = [".html", ".htm"];

export class YouTubeConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const url = (info.url ?? "").replace(/\\\?/g, "?").replace(/\\=/g, "=");
    if (!url.startsWith("https://www.youtube.com/watch?")) return false;
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXT.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME.some((p) => mime.startsWith(p));
  }

  async convert(stream: ByteStream, info: StreamInfo, ctx?: ConverterContext): Promise<DocumentConverterResult> {
    const html = new TextDecoder(info.charset ?? "utf-8").decode(stream.remaining());
    const $ = cheerio.load(html);
    const metadata: Record<string, string> = {};

    const pageTitle = $("title").first().text().trim();
    if (pageTitle) metadata.title = pageTitle;

    $("meta").each((_, el) => {
      const key = el.attribs.itemprop || el.attribs.property || el.attribs.name;
      const content = el.attribs.content;
      if (key && content) metadata[key] = content;
    });

    $("script").each((_, el) => {
      const content = $(el).html() ?? "";
      if (!content.includes("ytInitialData")) return;
      const match = /var ytInitialData = (\{.*?\});/s.exec(content);
      if (!match) return;
      try {
        const data = JSON.parse(match[1]);
        const desc = findKey(data, "attributedDescriptionBodyText");
        if (desc && typeof desc === "object" && "content" in desc) {
          metadata.description = String((desc as { content: string }).content);
        }
      } catch {
        // ignore parse errors
      }
    });

    let md = "# YouTube\n";
    const title = metadata.title ?? metadata["og:title"] ?? metadata.name ?? pageTitle;
    if (title) md += `\n## ${title}\n`;

    const stats: string[] = [];
    if (metadata.interactionCount) stats.push(`- **Views:** ${metadata.interactionCount}`);
    if (metadata.keywords) stats.push(`- **Keywords:** ${metadata.keywords}`);
    if (metadata.duration) stats.push(`- **Runtime:** ${metadata.duration}`);
    if (stats.length) md += `\n### Video Metadata\n${stats.join("\n")}\n`;

    const description = metadata.description ?? metadata["og:description"];
    if (description) md += `\n### Description\n${description}\n`;

    const videoId = extractVideoId(info.url ?? "");
    if (videoId) {
      try {
        const { YouTubeTranscriptApi } = await import("youtube-transcript-api-js");
        const api = new YouTubeTranscriptApi();
        const languages = (ctx?.youtubeTranscriptLanguages as string[] | undefined) ?? ["en"];
        const transcript = await api.fetch(videoId, languages);
        const text = transcript.snippets.map((s: { text: string }) => s.text).join(" ");
        if (text) md += `\n### Transcript\n${text}\n`;
      } catch {
        // transcript optional
      }
    }

    return { markdown: md, title: title ?? null };
  }
}

function extractVideoId(url: string): string | null {
  try {
    const id = new URL(url.replace(/\\/g, "")).searchParams.get("v");
    return id;
  } catch {
    return null;
  }
}

function findKey(json: unknown, key: string): unknown {
  if (Array.isArray(json)) {
    for (const item of json) {
      const found = findKey(item, key);
      if (found !== undefined) return found;
    }
  } else if (json && typeof json === "object") {
    for (const [k, v] of Object.entries(json)) {
      if (k === key) return v;
      const found = findKey(v, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
