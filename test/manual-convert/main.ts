import { Buffer } from "buffer";
import { gzipSync } from "fflate";
import { MarkItDown } from "../../src/convert/mark-it-down.js";

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;

const PKC_MAGIC = new Uint8Array([0x50, 0x4b, 0x43, 0x01]);

interface ConversionResult {
  markdown: string;
  title: string | null | undefined;
  baseName: string;
}

let selectedFile: File | null = null;
let lastResult: ConversionResult | null = null;
let lastPkc: Uint8Array | null = null;

const dropZone = document.getElementById("drop-zone")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const fileMeta = document.getElementById("file-meta")!;
const fileNameEl = document.getElementById("file-name")!;
const fileSizeEl = document.getElementById("file-size")!;
const convertBtn = document.getElementById("convert-btn") as HTMLButtonElement;
const pkcToggle = document.getElementById("pkc-toggle") as HTMLInputElement;
const statusEl = document.getElementById("status")!;
const downloadsEl = document.getElementById("downloads")!;
const previewEl = document.getElementById("preview")!;
const markdownOut = document.getElementById("markdown-out")!;
const dlMdBtn = document.getElementById("dl-md") as HTMLButtonElement;
const dlPkcBtn = document.getElementById("dl-pkc") as HTMLButtonElement;

function extname(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

function basename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(message: string, kind: "ok" | "err" | "" = "") {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function pickFile(file: File) {
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  fileMeta.hidden = false;
  convertBtn.disabled = false;
  downloadsEl.hidden = true;
  previewEl.hidden = true;
  lastResult = null;
  lastPkc = null;
  setStatus(`Ready to convert: ${file.name}`);
}

function packToPkcBrowser(markdown: string, meta: { title?: string | null; source?: string }): Uint8Array {
  const doc = {
    version: 1,
    title: meta.title ?? null,
    source: meta.source ?? null,
    mimetype: "text/markdown",
    markdown,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const compressed = gzipSync(json);
  const out = new Uint8Array(PKC_MAGIC.length + 4 + compressed.length);
  out.set(PKC_MAGIC, 0);
  new DataView(out.buffer).setUint32(PKC_MAGIC.length, compressed.length, false);
  out.set(compressed, PKC_MAGIC.length + 4);
  return out;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) pickFile(file);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file) pickFile(file);
});

convertBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  convertBtn.disabled = true;
  setStatus("Converting…");

  try {
    const bytes = new Uint8Array(await selectedFile.arrayBuffer());
    const extension = extname(selectedFile.name);
    const md = new MarkItDown();

    const result = await md.convertBytes(bytes, {
      extension,
      filename: selectedFile.name,
      mimetype: selectedFile.type || null,
    });

    const baseName = basename(selectedFile.name);
    lastResult = { markdown: result.markdown, title: result.title, baseName };

    if (pkcToggle.checked) {
      lastPkc = packToPkcBrowser(result.markdown, {
        title: result.title,
        source: selectedFile.name,
      });
    } else {
      lastPkc = null;
    }

    markdownOut.textContent = result.markdown;
    previewEl.hidden = false;
    downloadsEl.hidden = false;
    dlPkcBtn.hidden = !lastPkc;

    const title = result.title ? ` — ${result.title}` : "";
    setStatus(`Done${title} (${result.markdown.length.toLocaleString()} chars)`, "ok");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Conversion failed: ${message}`, "err");
    downloadsEl.hidden = true;
    previewEl.hidden = true;
    lastResult = null;
    lastPkc = null;
  } finally {
    convertBtn.disabled = !selectedFile;
  }
});

dlMdBtn.addEventListener("click", () => {
  if (!lastResult) return;
  downloadBlob(
    new Blob([lastResult.markdown], { type: "text/markdown;charset=utf-8" }),
    `${lastResult.baseName}.md`,
  );
});

dlPkcBtn.addEventListener("click", () => {
  if (!lastPkc || !lastResult) return;
  downloadBlob(new Blob([lastPkc], { type: "application/octet-stream" }), `${lastResult.baseName}.pkc`);
});
