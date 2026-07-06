import type { StreamInfo } from "../../types/stream-info.js";
import type { ByteStream } from "../../utils/byte-stream.js";
import type { DocumentConverter, DocumentConverterResult } from "../../types/converter.js";
import { MissingDependencyError } from "../../types/exceptions.js";

const ACCEPTED_MIME = ["application/vnd.ms-outlook"];
const ACCEPTED_EXT = [".msg"];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export class OutlookMsgConverter implements DocumentConverter {
  accepts(stream: ByteStream, info: StreamInfo): boolean {
    const ext = (info.extension ?? "").toLowerCase();
    if (ACCEPTED_EXT.includes(ext)) return true;
    const mime = (info.mimetype ?? "").toLowerCase();
    if (ACCEPTED_MIME.some((p) => mime.startsWith(p))) return true;

    const pos = stream.tell();
    try {
      const head = stream.read(8);
      return OLE_MAGIC.every((b, i) => head[i] === b);
    } finally {
      stream.seek(pos);
    }
  }

  async convert(stream: ByteStream): Promise<DocumentConverterResult> {
    let MsgReader: new (buf: Uint8Array) => { getFileData: () => Record<string, unknown> };
    try {
      const mod = await import("@kenjiuno/msgreader");
      MsgReader = (mod.default ?? mod) as typeof MsgReader;
    } catch {
      throw new MissingDependencyError("OutlookMsgConverter", "@kenjiuno/msgreader");
    }

    const reader = new MsgReader(stream.remaining());
    const data = reader.getFileData() as {
      subject?: string;
      senderName?: string;
      senderEmail?: string;
      body?: string;
      recipients?: Array<{ name?: string; email?: string }>;
    };

    const lines = ["# Email Message", ""];
    if (data.senderName || data.senderEmail) {
      const from =
        data.senderName && data.senderEmail
          ? `${data.senderName} <${data.senderEmail}>`
          : (data.senderName ?? data.senderEmail);
      lines.push(`**From:** ${from}`);
    }
    if (data.recipients?.length) {
      lines.push(`**To:** ${data.recipients.map((r) => r.name ?? r.email).filter(Boolean).join(", ")}`);
    }
    if (data.subject) lines.push(`**Subject:** ${data.subject}`);
    lines.push("", "## Content", "", data.body ?? "");

    return { markdown: lines.join("\n").trim(), title: data.subject ?? null };
  }
}
