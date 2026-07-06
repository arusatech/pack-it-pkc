import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { StreamInfo } from "../types/stream-info.js";
import { copyAndUpdate } from "../types/stream-info.js";
import type {
  ConverterContext,
  ConverterRegistration,
  DocumentConverter,
  DocumentConverterResult,
} from "../types/converter.js";
import {
  PRIORITY_GENERIC_FILE_FORMAT,
  PRIORITY_SPECIFIC_FILE_FORMAT,
} from "../types/converter.js";
import {
  FailedConversionAttempt,
  FileConversionError,
  UnsupportedFormatError,
} from "../types/exceptions.js";
import { guessStreamFormats } from "../detect/format-detector.js";
import { ByteStream } from "../utils/byte-stream.js";
import { normalizeMarkdown } from "../utils/normalize.js";
import { fileUriToPath, parseDataUri } from "../utils/uri.js";
import type { GgufInferenceProvider } from "../inference/types.js";
import {
  CsvConverter,
  HtmlConverter,
  ImageConverter,
  IpynbConverter,
  PdfConverter,
  PlainTextConverter,
  ZipConverter,
} from "./converters/index.js";

export interface MarkItDownOptions {
  enableBuiltins?: boolean;
  llmProvider?: GgufInferenceProvider;
  llmModel?: string;
  llmPrompt?: string;
  fetch?: typeof globalThis.fetch;
}

export type ConvertSource = string | Uint8Array | ArrayBuffer | ByteStream | Response;

/**
 * JavaScript port of Microsoft MarkItDown orchestrator.
 * Format detection uses magic bytes (no ONNX/Magika).
 * Vision/OCR uses GGUF via GgufInferenceProvider adapters.
 */
export class MarkItDown {
  private readonly converters: ConverterRegistration[] = [];
  private readonly options: MarkItDownOptions;
  private builtinsEnabled = false;

  constructor(options: MarkItDownOptions = {}) {
    this.options = options;
    if (options.enableBuiltins !== false) {
      this.enableBuiltins();
    }
  }

  enableBuiltins(): void {
    if (this.builtinsEnabled) return;

    this.registerConverter(new PlainTextConverter(), PRIORITY_GENERIC_FILE_FORMAT);
    this.registerConverter(new ZipConverter(this), PRIORITY_GENERIC_FILE_FORMAT);
    this.registerConverter(new HtmlConverter(), PRIORITY_GENERIC_FILE_FORMAT);
    this.registerConverter(new CsvConverter());
    this.registerConverter(new IpynbConverter());
    this.registerConverter(new PdfConverter());
    this.registerConverter(new ImageConverter());

    this.builtinsEnabled = true;
  }

  registerConverter(converter: DocumentConverter, priority = PRIORITY_SPECIFIC_FILE_FORMAT): void {
    this.converters.unshift({ converter, priority });
  }

  async convert(source: ConvertSource, streamInfo?: StreamInfo, ctx?: ConverterContext): Promise<DocumentConverterResult> {
    if (source instanceof ByteStream) {
      return this.convertStream(source, streamInfo, ctx);
    }
    if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
      return this.convertBytes(source instanceof Uint8Array ? source : new Uint8Array(source), {
        ...streamInfo,
        ...ctx,
      });
    }
    if (typeof Response !== "undefined" && source instanceof Response) {
      return this.convertResponse(source, streamInfo, ctx);
    }
    if (typeof source === "string") {
      if (/^(https?:|file:|data:)/.test(source)) {
        return this.convertUri(source, streamInfo, ctx);
      }
      return this.convertLocal(source, streamInfo, ctx);
    }
    throw new TypeError(`Unsupported source type: ${typeof source}`);
  }

  async convertLocal(path: string, streamInfo?: StreamInfo, ctx?: ConverterContext): Promise<DocumentConverterResult> {
    const bytes = await readFile(path);
    const base: StreamInfo = copyAndUpdate(
      { localPath: path, extension: extname(path), filename: basename(path) },
      streamInfo ?? {},
    );
    return this.convertBytes(bytes, { ...base, ...ctx });
  }

  async convertBytes(
    data: Uint8Array,
    meta: StreamInfo & ConverterContext = {},
  ): Promise<DocumentConverterResult> {
    const stream = ByteStream.fromBuffer(data);
    const { llmProvider, llmModel, llmPrompt, ...streamInfo } = meta;
    return this.convertStream(stream, streamInfo, { llmProvider, llmModel, llmPrompt, ...meta });
  }

  async convertStream(
    stream: ByteStream,
    streamInfo?: StreamInfo,
    ctx?: ConverterContext,
  ): Promise<DocumentConverterResult> {
    const guesses = await guessStreamFormats(stream, streamInfo ?? {});
    return this.runConverters(stream, guesses, ctx);
  }

  async convertUri(uri: string, streamInfo?: StreamInfo, ctx?: ConverterContext): Promise<DocumentConverterResult> {
    const trimmed = uri.trim();

    if (trimmed.startsWith("file:")) {
      const { netloc, path } = fileUriToPath(trimmed);
      if (netloc && netloc !== "localhost") {
        throw new Error(`Unsupported file URI host: ${netloc}`);
      }
      return this.convertLocal(path, streamInfo, ctx);
    }

    if (trimmed.startsWith("data:")) {
      const { mimetype, attributes, data } = parseDataUri(trimmed);
      return this.convertBytes(data, {
        mimetype,
        charset: attributes.charset ?? null,
        ...streamInfo,
        ...ctx,
      });
    }

    if (trimmed.startsWith("http:") || trimmed.startsWith("https:")) {
      const fetchFn = this.options.fetch ?? globalThis.fetch;
      const response = await fetchFn(trimmed, {
        headers: { Accept: "text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${trimmed}`);
      return this.convertResponse(response, { ...streamInfo, url: trimmed }, ctx);
    }

    throw new Error(`Unsupported URI scheme: ${trimmed.split(":")[0]}`);
  }

  async convertResponse(
    response: Response,
    streamInfo?: StreamInfo,
    ctx?: ConverterContext,
  ): Promise<DocumentConverterResult> {
    const contentType = response.headers.get("content-type") ?? "";
    const [mimetype, ...params] = contentType.split(";").map((s) => s.trim());
    let charset: string | null = null;
    for (const p of params) {
      if (p.toLowerCase().startsWith("charset=")) charset = p.split("=")[1]?.trim() ?? null;
    }

    let filename: string | null = null;
    let extension: string | null = null;
    const disposition = response.headers.get("content-disposition");
    if (disposition) {
      const m = /filename="?([^";]+)"?/.exec(disposition);
      if (m) {
        filename = m[1];
        extension = extname(filename);
      }
    }

    const url = response.url;
    if (!filename && url) {
      const pathExt = extname(new URL(url).pathname);
      if (pathExt) {
        extension = pathExt;
        filename = basename(new URL(url).pathname);
      }
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    return this.convertBytes(buffer, {
      mimetype: mimetype || null,
      charset,
      filename,
      extension,
      url,
      ...streamInfo,
      ...ctx,
    });
  }

  private async runConverters(
    stream: ByteStream,
    guesses: StreamInfo[],
    ctx?: ConverterContext,
  ): Promise<DocumentConverterResult> {
    const sorted = [...this.converters].sort((a, b) => a.priority - b.priority);
    const failed: FailedConversionAttempt[] = [];
    const startPos = stream.tell();

    const baseCtx: ConverterContext = {
      ...ctx,
      llmProvider: ctx?.llmProvider ?? this.options.llmProvider,
      llmModel: ctx?.llmModel ?? this.options.llmModel,
      llmPrompt: ctx?.llmPrompt ?? this.options.llmPrompt,
      parentConverters: this.converters,
    };

    for (const guess of [...guesses, {}]) {
      for (const { converter } of sorted) {
        stream.seek(startPos);
        let accepted = false;
        try {
          accepted = await converter.accepts(stream, guess, baseCtx);
        } catch {
          accepted = false;
        }
        stream.seek(startPos);

        if (!accepted) continue;

        try {
          const result = await converter.convert(stream, guess, baseCtx);
          return {
            markdown: normalizeMarkdown(result.markdown),
            title: result.title,
          };
        } catch (err) {
          failed.push({ converter, error: err });
        } finally {
          stream.seek(startPos);
        }
      }
    }

    if (failed.length > 0) throw new FileConversionError(failed);
    throw new UnsupportedFormatError();
  }
}
