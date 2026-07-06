import { gzipSync, gunzipSync } from "node:zlib";

export const PKC_MAGIC = new Uint8Array([0x50, 0x4b, 0x43, 0x01]); // PKC\x01
export const PKC_VERSION = 1;

export interface PkcDocument {
  version: number;
  title?: string | null;
  source?: string | null;
  mimetype?: string | null;
  markdown: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface PackOptions {
  title?: string | null;
  source?: string | null;
  mimetype?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Pack Markdown into PKC binary container (magic header + gzip JSON payload).
 */
export function packToPkc(markdown: string, options: PackOptions = {}): Uint8Array {
  const doc: PkcDocument = {
    version: PKC_VERSION,
    title: options.title ?? null,
    source: options.source ?? null,
    mimetype: options.mimetype ?? "text/markdown",
    markdown,
    metadata: options.metadata ?? {},
    createdAt: new Date().toISOString(),
  };

  const json = Buffer.from(JSON.stringify(doc), "utf-8");
  const compressed = gzipSync(json);

  const out = new Uint8Array(PKC_MAGIC.length + 4 + compressed.length);
  out.set(PKC_MAGIC, 0);
  new DataView(out.buffer).setUint32(PKC_MAGIC.length, compressed.length, false);
  out.set(compressed, PKC_MAGIC.length + 4);
  return out;
}

export function unpackPkc(data: Uint8Array): PkcDocument {
  if (data.length < PKC_MAGIC.length + 4) throw new Error("Invalid PKC: too short");
  for (let i = 0; i < PKC_MAGIC.length; i++) {
    if (data[i] !== PKC_MAGIC[i]) throw new Error("Invalid PKC magic header");
  }

  const payloadLen = new DataView(data.buffer, data.byteOffset).getUint32(PKC_MAGIC.length, false);
  const payload = data.subarray(PKC_MAGIC.length + 4, PKC_MAGIC.length + 4 + payloadLen);
  const json = gunzipSync(payload);
  return JSON.parse(json.toString("utf-8")) as PkcDocument;
}

export interface PackAndConvertOptions extends PackOptions {
  markItDown?: import("../convert/mark-it-down.js").MarkItDownOptions;
}

/**
 * End-to-end: convert any supported document to Markdown, then pack into PKC.
 */
export async function packIt(
  source: import("../convert/mark-it-down.js").ConvertSource,
  options: PackAndConvertOptions = {},
): Promise<{ pkc: Uint8Array; document: PkcDocument; conversion: import("../types/converter.js").DocumentConverterResult }> {
  const { MarkItDown } = await import("../convert/mark-it-down.js");
  const engine = new MarkItDown(options.markItDown);
  const conversion = await engine.convert(source);
  const document: PkcDocument = {
    version: PKC_VERSION,
    title: options.title ?? conversion.title ?? null,
    source: options.source ?? (typeof source === "string" ? source : null),
    mimetype: options.mimetype ?? null,
    markdown: conversion.markdown,
    metadata: options.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
  const pkc = packToPkc(conversion.markdown, options);
  return { pkc, document, conversion };
}
