import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";

const ACCEPTED_MIME = ["audio/x-wav", "audio/mpeg", "audio/mp4", "video/mp4", "audio/mp3"];
const ACCEPTED_EXT = [".wav", ".mp3", ".m4a", ".mp4"];

const META_FIELDS = [
  "title",
  "artist",
  "album",
  "genre",
  "track",
  "date",
  "year",
  "comment",
  "composer",
  "encoder",
  "bitrate",
  "sampleRate",
  "numberOfChannels",
];

export class AudioConverter implements DocumentConverter {
  accepts(_stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXT.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    return ACCEPTED_MIME.some((p) => mime.startsWith(p));
  }

  async convert(stream: ByteStream, info: StreamInfo): Promise<DocumentConverterResult> {
    const bytes = stream.remaining();
    const lines: string[] = [];

    try {
      const { parseBuffer } = await import("music-metadata");
      const metadata = await parseBuffer(Buffer.from(bytes), {
        mimeType: info.mimetype ?? undefined,
      });
      const common = metadata.common as {
        title?: string;
        artist?: string;
        album?: string;
        genre?: string[];
        track?: { no?: number | null };
        date?: Date;
        year?: number;
        comment?: string[];
        composer?: string[];
      };
      const format = metadata.format as {
        bitrate?: number;
        sampleRate?: number;
        numberOfChannels?: number;
      };
      const mapped: Record<string, string | number | undefined> = {
        title: common.title,
        artist: common.artist,
        album: common.album,
        genre: common.genre?.join(", "),
        track: common.track?.no ?? undefined,
        date: common.date?.toISOString?.(),
        year: common.year,
        comment: common.comment?.join(", "),
        composer: common.composer?.join(", "),
        bitrate: format.bitrate,
        sampleRate: format.sampleRate,
        numberOfChannels: format.numberOfChannels,
      };
      for (const field of META_FIELDS) {
        const val = mapped[field];
        if (val !== undefined && val !== null && val !== "") {
          lines.push(`${field}: ${val}`);
        }
      }
    } catch {
      lines.push(`filename: ${info.filename ?? "audio"}`);
    }

    return { markdown: lines.join("\n").trim(), title: info.filename ?? null };
  }
}
