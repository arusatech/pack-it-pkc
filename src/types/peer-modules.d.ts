declare module "@kenjiuno/msgreader" {
  export default class MsgReader {
    constructor(buf: Uint8Array);
    getFileData(): Record<string, unknown>;
  }
}

declare module "youtube-transcript-api-js" {
  export class YouTubeTranscriptApi {
    fetch(videoId: string, languages?: string[]): Promise<{ snippets: Array<{ text: string }> }>;
  }
}

declare module "music-metadata" {
  export function parseBuffer(
    buf: Buffer,
    opts?: { mimeType?: string },
  ): Promise<{
    common: Record<string, unknown>;
    format: Record<string, unknown>;
  }>;
}

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(opts: Record<string, unknown>): { promise: Promise<PdfDocument> };
  interface PdfDocument {
    numPages: number;
    getPage(n: number): Promise<PdfPage>;
    getMetadata(): Promise<{ info?: Record<string, unknown> }>;
  }
  interface PdfPage {
    getViewport(opts: { scale: number }): { height: number; width: number };
    getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[]; width?: number }> }>;
  }
}

declare module "mammoth" {
  export function convertToHtml(
    input: { buffer: Buffer },
    options?: { styleMap?: string },
  ): Promise<{ value: string }>;
}

declare module "xlsx" {
  export interface WorkSheet {
    [key: string]: unknown;
  }
  export function read(data: Buffer, opts: { type: "buffer" }): {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  };
  export const utils: {
    sheet_to_html(sheet: WorkSheet, opts?: { id?: string }): string;
  };
}

declare module "jszip" {
  export default class JSZip {
    static loadAsync(data: Uint8Array): Promise<JSZip>;
    files: Record<string, { async(type: "string"): Promise<string>; async(type: "arraybuffer"): Promise<ArrayBuffer> }>;
    file(name: string): { async(type: "string"): Promise<string>; async(type: "arraybuffer"): Promise<ArrayBuffer> } | null;
  }
}

declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    info?: { Title?: string };
  }
  function pdfParse(buf: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}

declare module "node-llama-cpp" {
  export function getLlama(): Promise<{
    loadModel(opts: { modelPath: string }): Promise<{
      createContext(): Promise<{
        completion(opts: { messages: Array<{ role: string; content: string }> }): Promise<string>;
      }>;
    }>;
  }>;
}

declare module "llama-cpp-capacitor" {
  const LlamaCpp: unknown;
  export { LlamaCpp };
  export default LlamaCpp;
}
