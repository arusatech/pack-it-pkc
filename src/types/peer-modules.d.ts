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
    buf: Uint8Array | Buffer,
    opts?: { mimeType?: string },
  ): Promise<{
    common: Record<string, unknown>;
    format: Record<string, unknown>;
  }>;
}

declare module "mammoth" {
  export function convertToHtml(
    input: { buffer: Uint8Array | Buffer },
    options?: { styleMap?: string },
  ): Promise<{ value: string }>;
}

declare module "xlsx" {
  export interface WorkSheet {
    [key: string]: unknown;
  }
  export function read(
    data: Buffer | Uint8Array | ArrayBuffer | string,
    opts: { type: "buffer" | "array" | "base64" | "binary" | "string" },
  ): {
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

declare module "@capacitor/filesystem" {
  export const Filesystem: {
    Directory: { Data: string; [key: string]: string };
    Encoding?: { UTF8: string };
    writeFile: (opts: {
      path: string;
      data: string;
      directory: string;
      recursive?: boolean;
    }) => Promise<{ uri?: string } | void>;
    readFile: (opts: {
      path: string;
      directory: string;
      encoding?: string;
    }) => Promise<{ data: string }>;
    deleteFile: (opts: { path: string; directory: string }) => Promise<void>;
    mkdir: (opts: { path: string; directory: string; recursive?: boolean }) => Promise<void>;
    getUri: (opts: { path: string; directory: string }) => Promise<{ uri: string }>;
  };
  export default Filesystem;
}

declare module "llama-cpp-capacitor" {
  const LlamaCpp: unknown;
  export { LlamaCpp };
  export default LlamaCpp;
}
