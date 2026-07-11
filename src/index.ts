export {
  ASSET_ROOT,
  PACKAGE_NAME,
  KATEX_ASSETS,
  LANGUAGE_FONT_IDS,
  LANGUAGE_FONTS_CSS,
  languageFontPath,
  katexFontGlob,
  type LanguageFontId,
} from "./assets/manifest.js";

export { MarkItDown, type MarkItDownOptions } from "./convert/index.js";
export * from "./convert/converters/index.js";
export * from "./detect/index.js";
export * from "./inference/index.js";
export * from "./pkc/index.js";
export type { StreamInfo } from "./types/stream-info.js";
export type { DocumentConverter, DocumentConverterResult } from "./types/converter.js";
export {
  PackItPkcError,
  MissingDependencyError,
  UnsupportedFormatError,
  FileConversionError,
} from "./types/exceptions.js";
export { ByteStream } from "./utils/byte-stream.js";
export {
  extractPdfBlocks,
  extractPdfMarkdown,
  blocksToMarkdown,
  setPdfBlock,
  getPdfBlock,
  syncTableBlockContent,
  savePdfBlocksLocal,
  loadPdfBlocksLocal,
  type PdfDocumentBlocks,
  type PdfBlock,
  type PdfBlockType,
  type ExtractPdfOptions,
} from "./pdf/index.js";
export {
  normalizeChemistryWithAssist,
  llmPlainToMhchem,
} from "./pdf/chemistry-llm-assist.js";
export {
  normalizeMathWithAssist,
  llmPlainToLatex,
} from "./pdf/math-llm-assist.js";

