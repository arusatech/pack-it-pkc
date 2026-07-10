import type { StreamInfo } from "./stream-info.js";
import type { ByteStream } from "../utils/byte-stream.js";

export interface DocumentConverterResult {
  markdown: string;
  title?: string | null;
  /** Present when source was PDF — editable block model before markdown render. */
  pdfBlocks?: import("../pdf/pdf-block-types.js").PdfDocumentBlocks;
}

export interface ConverterContext {
  llmProvider?: import("../inference/types.js").GgufInferenceProvider;
  llmModel?: string;
  llmPrompt?: string;
  parentConverters?: ConverterRegistration[];
  [key: string]: unknown;
}

export interface DocumentConverter {
  accepts(stream: ByteStream, info: StreamInfo, ctx?: ConverterContext): boolean | Promise<boolean>;
  convert(
    stream: ByteStream,
    info: StreamInfo,
    ctx?: ConverterContext,
  ): DocumentConverterResult | Promise<DocumentConverterResult>;
}

export interface ConverterRegistration {
  converter: DocumentConverter;
  priority: number;
}

export const PRIORITY_SPECIFIC_FILE_FORMAT = 0;
export const PRIORITY_GENERIC_FILE_FORMAT = 10;
