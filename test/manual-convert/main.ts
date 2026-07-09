import { Buffer } from "buffer";
import { gzipSync } from "fflate";
import { MarkItDown } from "../../src/convert/mark-it-down.js";
import { extractPdfBlocks, blocksToMarkdown } from "../../src/convert/pdf/index.js";
import type { PdfDocumentBlocks } from "../../src/convert/pdf/pdf-block-types.js";
import { loadPdfBlocksLocal, savePdfBlocksLocal } from "./pdf-blocks-local-storage.js";
import { PdfCanvasEditor } from "./pdf-canvas-editor.js";

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;

const PKC_MAGIC = new Uint8Array([0x50, 0x4b, 0x43, 0x01]);

interface ConversionResult {
  markdown: string;
  title: string | null | undefined;
  baseName: string;
  pdfBlocks?: PdfDocumentBlocks;
}

interface QueuedFile {
  id: string;
  file: File;
}

let fileQueue: QueuedFile[] = [];
let activeFileId: string | null = null;
let selectedBytes: Uint8Array | null = null;
let lastResult: ConversionResult | null = null;
let lastPkc: Uint8Array | null = null;
let canvasEditor: PdfCanvasEditor | null = null;
let imageColorMode = false;
let modelOpen = false;
let processing = false;

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const fileSelect = document.getElementById("file-select") as HTMLSelectElement;
const addFileBtn = document.getElementById("add-file-btn")!;
const processBtn = document.getElementById("process-btn") as HTMLButtonElement;
const modelBtn = document.getElementById("model-btn") as HTMLButtonElement;
const modelCard = document.getElementById("model-card")!;
const modelClose = document.getElementById("model-close")!;
const colorToggle = document.getElementById("color-toggle") as HTMLButtonElement;
const dropZone = document.getElementById("drop-zone")!;
const pkcToggle = document.getElementById("pkc-toggle") as HTMLInputElement;
const statusEl = document.getElementById("status")!;
const previewEl = document.getElementById("preview")!;
const editorEl = document.getElementById("pdf-editor")!;
const markdownOut = document.getElementById("markdown-out")!;
const dlMdBtn = document.getElementById("dl-md") as HTMLButtonElement;
const dlPkcBtn = document.getElementById("dl-pkc") as HTMLButtonElement;
const dlJsonBtn = document.getElementById("dl-json") as HTMLButtonElement;

function extname(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

function basename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function isPdf(file: File): boolean {
  return extname(file.name) === ".pdf" || file.type === "application/pdf";
}

function activeFile(): File | null {
  return fileQueue.find((q) => q.id === activeFileId)?.file ?? null;
}

function setStatus(message: string, kind: "ok" | "err" | "" = "") {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function updateColorToggleUi(): void {
  colorToggle.classList.toggle("active", imageColorMode);
  colorToggle.setAttribute("aria-pressed", String(imageColorMode));
  colorToggle.title = imageColorMode
    ? "Colour ON — tap for monochrome"
    : "Monochrome — tap for colour";
  canvasEditor?.setImageColorMode(imageColorMode);
}

function updateModelUi(): void {
  modelCard.hidden = !modelOpen;
  modelBtn.classList.toggle("active", modelOpen);
  modelBtn.setAttribute("aria-expanded", String(modelOpen));
}

function updateDownloadButtons(): void {
  const hasResult = !!lastResult;
  dlMdBtn.disabled = !hasResult;
  dlJsonBtn.disabled = !hasResult || !lastResult?.pdfBlocks;
  dlJsonBtn.hidden = !lastResult?.pdfBlocks;
  dlPkcBtn.disabled = !lastPkc;
}

function refreshFileSelect(): void {
  const prev = fileSelect.value;
  fileSelect.innerHTML = "";

  if (fileQueue.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No file";
    fileSelect.append(opt);
    fileSelect.disabled = true;
    processBtn.disabled = true;
    dropZone.hidden = false;
    return;
  }

  dropZone.hidden = true;
  fileSelect.disabled = false;
  processBtn.disabled = processing || !activeFileId;

  for (const item of fileQueue) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.file.name;
    fileSelect.append(opt);
  }

  if (activeFileId && fileQueue.some((q) => q.id === activeFileId)) {
    fileSelect.value = activeFileId;
  } else {
    activeFileId = fileQueue[0]!.id;
    fileSelect.value = activeFileId;
  }

  if (prev && fileQueue.some((q) => q.id === prev)) {
    fileSelect.value = prev;
    activeFileId = prev;
  }
}

function destroyEditor(): void {
  canvasEditor?.destroy();
  canvasEditor = null;
  editorEl.hidden = true;
  editorEl.innerHTML = "";
}

function resetOutput(): void {
  destroyEditor();
  lastResult = null;
  lastPkc = null;
  selectedBytes = null;
  previewEl.hidden = true;
  updateDownloadButtons();
}

function enqueueFiles(files: FileList | File[]): void {
  const list = [...files];
  if (!list.length) return;

  for (const file of list) {
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    fileQueue.push({ id, file });
    if (!activeFileId) activeFileId = id;
  }

  refreshFileSelect();
  resetOutput();
  setStatus(`Added ${list.length} file${list.length > 1 ? "s" : ""} — tap Process`);
}

function switchFile(fileId: string): void {
  if (!fileQueue.some((q) => q.id === fileId)) return;
  activeFileId = fileId;
  resetOutput();
  const file = activeFile();
  setStatus(file ? `Selected: ${file.name}` : "");
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

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function applyResult(markdown: string, title: string | null | undefined, pdfBlocks?: PdfDocumentBlocks): void {
  const file = activeFile();
  if (!file) return;

  const baseName = basename(file.name);
  lastResult = { markdown, title, baseName, pdfBlocks };
  lastPkc = pkcToggle.checked
    ? packToPkcBrowser(markdown, { title, source: file.name })
    : null;

  markdownOut.textContent = markdown;
  previewEl.hidden = false;
  updateDownloadButtons();
}

function mountPdfEditor(bytes: Uint8Array, doc: PdfDocumentBlocks, title: string | null | undefined): void {
  const file = activeFile();
  if (!file) return;

  destroyEditor();
  editorEl.hidden = false;

  canvasEditor = new PdfCanvasEditor({
    container: editorEl,
    fileName: file.name,
    pdfBytes: bytes,
    doc,
    imageColorMode,
    onChange: (updated, markdown) => {
      applyResult(markdown, updated.title ?? title, updated);
      setStatus(`Blocks updated · ${markdown.length.toLocaleString()} chars`, "ok");
    },
  });

  applyResult(blocksToMarkdown(doc), doc.title ?? title, doc);
}

async function runProcess(): Promise<void> {
  const file = activeFile();
  if (!file || processing) return;

  processing = true;
  processBtn.disabled = true;
  setStatus("Processing…");
  destroyEditor();

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    selectedBytes = bytes;
    const extension = extname(file.name);

    if (isPdf(file)) {
      setStatus("Parsing PDF blocks…");
      const cached = loadPdfBlocksLocal(file.name);
      const doc = cached ?? (await extractPdfBlocks(bytes, { sort: true }));
      if (!cached) savePdfBlocksLocal(file.name, doc);

      mountPdfEditor(bytes, doc, doc.title ?? null);
      const title = doc.title ? ` — ${doc.title}` : "";
      setStatus(`PDF ready${title}`, "ok");
      return;
    }

    const md = new MarkItDown();
    const result = await md.convertBytes(bytes, {
      extension,
      filename: file.name,
      mimetype: file.type || null,
    });
    applyResult(result.markdown, result.title, result.pdfBlocks);
    const title = result.title ? ` — ${result.title}` : "";
    setStatus(`Done${title} (${result.markdown.length.toLocaleString()} chars)`, "ok");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Failed: ${message}`, "err");
    resetOutput();
  } finally {
    processing = false;
    refreshFileSelect();
  }
}

// ── Header events ──

colorToggle.addEventListener("click", () => {
  imageColorMode = !imageColorMode;
  updateColorToggleUi();
});

addFileBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) enqueueFiles(fileInput.files);
  fileInput.value = "";
});

fileSelect.addEventListener("change", () => {
  if (fileSelect.value) switchFile(fileSelect.value);
});

processBtn.addEventListener("click", () => void runProcess());

modelBtn.addEventListener("click", () => {
  modelOpen = !modelOpen;
  updateModelUi();
});

modelClose.addEventListener("click", () => {
  modelOpen = false;
  updateModelUi();
});

dropZone.addEventListener("click", () => fileInput.click());

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer?.files?.length) enqueueFiles(e.dataTransfer.files);
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

dlJsonBtn.addEventListener("click", () => {
  const blocks = canvasEditor?.getDocument() ?? lastResult?.pdfBlocks;
  if (!blocks || !lastResult) return;
  downloadBlob(
    new Blob([JSON.stringify(blocks, null, 2)], { type: "application/json;charset=utf-8" }),
    `${lastResult.baseName}.blocks.json`,
  );
});

pkcToggle.addEventListener("change", () => {
  if (lastResult) {
    lastPkc = pkcToggle.checked
      ? packToPkcBrowser(lastResult.markdown, {
          title: lastResult.title,
          source: activeFile()?.name,
        })
      : null;
    updateDownloadButtons();
  }
});

// ── Init ──

refreshFileSelect();
updateColorToggleUi();
updateModelUi();
updateDownloadButtons();
setStatus("Add a file, then Process");
