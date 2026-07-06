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
