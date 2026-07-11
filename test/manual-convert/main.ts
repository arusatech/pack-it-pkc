import { Buffer } from "buffer";
import { gzipSync } from "fflate";
import "../../assets/katex/katex.css";
import { MarkItDown } from "../../src/convert/mark-it-down.js";
import {
  extractPdfBlocks,
  blocksToMarkdown,
  loadPdfBlocksLocal,
  savePdfBlocksLocal,
  type PdfDocumentBlocks,
} from "../../src/pdf/index.js";
import { PdfCanvasEditor } from "../../src/pdf/editor.js";
import type { GgufInferenceProvider } from "../../src/inference/types.js";
import {
  download_model,
  getActiveModelId,
  isChatCapableModel,
  listModelsWithStatus,
  LFM2_CHAT_MODEL_ID,
  DEFAULT_OFFLINE_MODEL_ID,
  setActiveModelId,
} from "../../src/inference/index.js";
import {
  generateStudyPkc,
  type PkcStudyDocument,
} from "../../src/pkc/index.js";

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
let lastStudyPkc: Uint8Array | null = null;
let lastStudyDoc: PkcStudyDocument | null = null;
let canvasEditor: PdfCanvasEditor | null = null;
let imageColorMode = false;
let modelOpen = false;
let processing = false;
let generatingStudyPkc = false;
let ggufDownloading = false;
let llmProvider: GgufInferenceProvider | null = null;

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const fileSelect = document.getElementById("file-select") as HTMLSelectElement;
const addFileBtn = document.getElementById("add-file-btn")!;
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
const dlStudyPkcBtn = document.getElementById("dl-study-pkc") as HTMLButtonElement;
const generateStudyPkcBtn = document.getElementById("generate-study-pkc-btn") as HTMLButtonElement;
const studyPkcStatus = document.getElementById("study-pkc-status")!;
const studyPkcSummary = document.getElementById("study-pkc-summary") as HTMLPreElement;
const ggufModelSelect = document.getElementById("gguf-model-select") as HTMLSelectElement;
const ggufDownloadBtn = document.getElementById("gguf-download-btn") as HTMLButtonElement;
const ggufSetActiveBtn = document.getElementById("gguf-set-active-btn") as HTMLButtonElement;
const ggufModelStatus = document.getElementById("gguf-model-status")!;

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
  dlStudyPkcBtn.disabled = !lastStudyPkc;
  generateStudyPkcBtn.disabled = !lastResult?.pdfBlocks || generatingStudyPkc;
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
    dropZone.hidden = false;
    return;
  }

  dropZone.hidden = true;
  fileSelect.disabled = false;

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
  lastStudyPkc = null;
  lastStudyDoc = null;
  selectedBytes = null;
  previewEl.hidden = true;
  studyPkcSummary.hidden = true;
  studyPkcSummary.textContent = "";
  studyPkcStatus.hidden = true;
  studyPkcStatus.textContent = "";
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
  setStatus(`Added ${list.length} file${list.length > 1 ? "s" : ""}…`);
  void runProcess();
}

function switchFile(fileId: string): void {
  if (!fileQueue.some((q) => q.id === fileId)) return;
  activeFileId = fileId;
  resetOutput();
  void runProcess();
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
  lastStudyPkc = null;
  lastStudyDoc = null;
  studyPkcSummary.hidden = true;
  studyPkcSummary.textContent = "";
  studyPkcStatus.hidden = true;
  studyPkcStatus.textContent = "";

  markdownOut.textContent = markdown;
  previewEl.hidden = false;
  updateDownloadButtons();
}

async function handleGenerateStudyPkc(): Promise<void> {
  const doc = canvasEditor?.getDocument() ?? lastResult?.pdfBlocks;
  if (!doc || !lastResult || generatingStudyPkc) return;

  generatingStudyPkc = true;
  updateDownloadButtons();
  studyPkcStatus.hidden = false;
  studyPkcStatus.textContent = "Generating study PKC…";
  studyPkcSummary.hidden = true;

  try {
    const result = await generateStudyPkc(doc, {
      title: lastResult.title,
      source: activeFile()?.name ?? lastResult.baseName,
      llmProvider,
      chatModelId: getActiveModelId() ?? LFM2_CHAT_MODEL_ID,
      embeddingModelId: DEFAULT_OFFLINE_MODEL_ID,
      onProgress: (msg) => {
        studyPkcStatus.hidden = false;
        studyPkcStatus.textContent = msg;
      },
    });

    lastStudyPkc = result.pkc;
    lastStudyDoc = result.document;
    const { stats, models, warnings } = result.document;
    const lines = [
      `blocks: ${stats.blockCount}`,
      `chunks: ${stats.chunkCount} (embedded: ${stats.embeddedChunkCount})`,
      `flashcards: ${stats.flashCardCount}`,
      `mcqs: ${stats.mcqCount}`,
      `models: embedding=${models.embedding ?? "—"} chat=${models.chat ?? "—"}`,
    ];
    if (warnings?.length) {
      lines.push("", "warnings:", ...warnings.map((w) => `· ${w}`));
    }
    studyPkcSummary.textContent = lines.join("\n");
    studyPkcSummary.hidden = false;
    studyPkcStatus.textContent = result.warnings.length
      ? `Study PKC ready with ${result.warnings.length} warning(s)`
      : "Study PKC ready";
    setStatus(
      `Study PKC · ${stats.flashCardCount} flash · ${stats.mcqCount} MCQ · ${stats.embeddedChunkCount}/${stats.chunkCount} embedded`,
      "ok",
    );
  } catch (err) {
    lastStudyPkc = null;
    lastStudyDoc = null;
    studyPkcSummary.hidden = true;
    studyPkcStatus.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    setStatus(`Study PKC failed: ${err instanceof Error ? err.message : String(err)}`, "err");
  } finally {
    generatingStudyPkc = false;
    updateDownloadButtons();
  }
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
    llmProvider,
    getAssistModelId: () => getActiveModelId() || LFM2_CHAT_MODEL_ID,
    onAssistProgress: (msg) => setStatus(msg),
    onChange: (updated, markdown) => {
      applyResult(markdown, updated.title ?? title, updated);
      setStatus(`Blocks updated · ${markdown.length.toLocaleString()} chars`, "ok");
    },
  });

  applyResult(blocksToMarkdown(doc), doc.title ?? title, doc);
}

async function tryCreateLlmProvider(): Promise<GgufInferenceProvider | null> {
  try {
    const { CapacitorGgufProvider } = await import("../../src/inference/capacitor-provider.js");
    return await CapacitorGgufProvider.create();
  } catch (err) {
    console.warn("[manual-convert] CapacitorGgufProvider unavailable", err);
    return null;
  }
}

async function refreshGgufModelSelect(): Promise<void> {
  const models = await listModelsWithStatus();
  const active = getActiveModelId();
  const prev = ggufModelSelect.value || active;
  ggufModelSelect.innerHTML = "";

  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    const chat = isChatCapableModel(m.id) ? "chat" : "embed";
    const state = m.status === "downloaded" ? "downloaded" : "not downloaded";
    opt.textContent = `${m.name} · ${m.sizeMB} MB · ${chat} · ${state}`;
    ggufModelSelect.append(opt);
  }

  if (models.some((m) => m.id === prev)) ggufModelSelect.value = prev;
  else if (models.some((m) => m.id === active)) ggufModelSelect.value = active;
  else if (models[0]) ggufModelSelect.value = models[0].id;

  updateGgufModelStatus();
}

function updateGgufModelStatus(): void {
  const id = ggufModelSelect.value || getActiveModelId();
  const active = getActiveModelId();
  const providerNote = llmProvider
    ? "LLM provider ready"
    : "No LLM provider (download still works; AI fix needs llama-cpp-capacitor)";
  ggufModelStatus.textContent = `Selected: ${id} · Active: ${active} · ${providerNote}`;
  ggufDownloadBtn.disabled = ggufDownloading || !id;
  ggufSetActiveBtn.disabled = !id;
}

async function handleGgufDownload(): Promise<void> {
  const modelId = ggufModelSelect.value;
  if (!modelId || ggufDownloading) return;

  ggufDownloading = true;
  updateGgufModelStatus();
  setStatus(`Downloading ${modelId}…`);

  try {
    const info = await download_model(modelId, {
      onProgress: (p) => {
        setStatus(`Downloading ${modelId}… ${p.percentage}%`);
        ggufModelStatus.textContent = `Downloading ${modelId}: ${p.percentage}% (${p.loaded.toLocaleString()} / ${p.total.toLocaleString()} bytes)`;
      },
    });
    setActiveModelId(modelId);
    await refreshGgufModelSelect();
    setStatus(`Downloaded ${modelId} (${info.sizeBytes.toLocaleString()} bytes)`, "ok");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Download failed: ${message}`, "err");
    ggufModelStatus.textContent = message;
  } finally {
    ggufDownloading = false;
    updateGgufModelStatus();
  }
}

function handleSetActiveModel(): void {
  const modelId = ggufModelSelect.value;
  if (!modelId) return;
  setActiveModelId(modelId);
  updateGgufModelStatus();
  setStatus(`Active model: ${modelId}`, "ok");
}

async function runProcess(): Promise<void> {
  const file = activeFile();
  if (!file || processing) return;

  processing = true;
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

modelBtn.addEventListener("click", () => {
  modelOpen = !modelOpen;
  updateModelUi();
  if (modelOpen) void refreshGgufModelSelect();
});

modelClose.addEventListener("click", () => {
  modelOpen = false;
  updateModelUi();
});

ggufDownloadBtn.addEventListener("click", () => void handleGgufDownload());
ggufSetActiveBtn.addEventListener("click", () => handleSetActiveModel());
ggufModelSelect.addEventListener("change", () => updateGgufModelStatus());

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

dlStudyPkcBtn.addEventListener("click", () => {
  if (!lastStudyPkc || !lastResult) return;
  downloadBlob(
    new Blob([lastStudyPkc], { type: "application/octet-stream" }),
    `${lastResult.baseName}.study.pkc`,
  );
});

dlJsonBtn.addEventListener("click", () => {
  const blocks = canvasEditor?.getDocument() ?? lastResult?.pdfBlocks;
  if (!blocks || !lastResult) return;
  downloadBlob(
    new Blob([JSON.stringify(blocks, null, 2)], { type: "application/json;charset=utf-8" }),
    `${lastResult.baseName}.blocks.json`,
  );
});

generateStudyPkcBtn.addEventListener("click", () => void handleGenerateStudyPkc());

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
void (async () => {
  llmProvider = await tryCreateLlmProvider();
  await refreshGgufModelSelect();
  canvasEditor?.setLlmProvider(llmProvider);
  setStatus(
    llmProvider
      ? "Add a file to begin · LLM provider ready for AI fix"
      : "Add a file to begin · download models anytime; AI fix needs llama-cpp-capacitor",
  );
})();
setStatus("Add a file to begin");
