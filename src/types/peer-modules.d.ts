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
  interface JSZipObject {
    dir: boolean;
    async(type: "string"): Promise<string>;
    async(type: "arraybuffer"): Promise<ArrayBuffer>;
    async(type: "uint8array"): Promise<Uint8Array>;
  }

  export default class JSZip {
    static loadAsync(data: Uint8Array): Promise<JSZip>;
    files: Record<string, JSZipObject>;
    file(name: string, data?: Uint8Array | string): JSZipObject | null;
    generateAsync(options: { type: "arraybuffer" }): Promise<ArrayBuffer>;
  }
}

declare module "node-llama-cpp" {
  export class LlamaChatSession {
    constructor(opts: { contextSequence: unknown });
    prompt(text: string, options?: { maxTokens?: number }): Promise<string>;
  }

  export function getLlama(): Promise<{
    loadModel(opts: { modelPath: string }): Promise<{
      createContext(): Promise<{
        getSequence(): unknown;
      }>;
    }>;
  }>;
}

declare module "llama-cpp-capacitor" {
  const LlamaCpp: unknown;
  export { LlamaCpp };
  export default LlamaCpp;
}
