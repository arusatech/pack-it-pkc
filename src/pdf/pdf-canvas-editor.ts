import type {
  PdfBlock,
  PdfBlockType,
  PdfBBox,
  PdfDocumentBlocks,
  PdfImageBlock,
  PdfQaBlock,
  PdfTableBlock,
  PdfTextBlock,
} from "./pdf-block-types.js";
import { sortBlocksByPosition } from "./pdf-block-types.js";
import { blocksToMarkdown, syncTableBlockContent, tableRowsToMarkdown } from "./pdf-blocks-to-markdown.js";
import { savePdfBlocksLocal } from "./pdf-blocks-storage.js";
import {
  extractImageRegionTextFromPdf,
  extractSearchTokensFromText,
  processBlockRegionFromPdf,
} from "./pdf-block-region-processor.js";
import { extractPdfPageBlocks } from "./pdf-extractor.js";
import { asQaBlock, isQaPlaceholder, isQaSegment, qaPart, qaPartsToContent } from "./pdf-qa.js";
import { containsMathOrChemistry, mountFormulaPreview } from "./katex-service.js";
import { llmPlainToMhchem } from "./chemistry-llm-assist.js";
import { llmPlainToLatex } from "./math-llm-assist.js";
import { collapseNewlinesToSpaces, WRAP_TOGGLE_ICON_SVG } from "./pdf-block-text-wrap.js";
import { renderPdfBboxToCanvas, renderPdfPageDataUrl, type PageRenderInfo } from "./pdf-page-renderer.js";
import { optimizeImageCanvasToDataUrl } from "./image-optimize.js";
import type { GgufInferenceProvider } from "../inference/types.js";
import { getActiveModelId } from "../inference/model-session.js";
import { LFM2_CHAT_MODEL_ID } from "../inference/model-catalog.js";

type CanvasTagKind = "text" | "table" | "image" | "qa" | "math" | "formula" | "question" | "answer";

/** Tags shown in the “Tag this region” menu (question + answer merged as Q & A). */
const TAG_MENU_KINDS: Array<"text" | "table" | "image" | "qa" | "math" | "formula"> = [
  "text",
  "table",
  "image",
  "qa",
  "math",
  "formula",
];

const TAG_COLOR: Record<CanvasTagKind, string> = {
  text: "#3880ff",
  table: "#ffc409",
  image: "#7044ff",
  qa: "#14b8a6",
  question: "#14b8a6",
  answer: "#14b8a6",
  math: "#2dd36f",
  formula: "#eb445a",
};

const TAG_LABEL: Record<CanvasTagKind, string> = {
  text: "Text",
  table: "Table",
  image: "Image",
  qa: "Q & A",
  question: "Q & A",
  answer: "Q & A",
  math: "Math",
  formula: "Formula",
};

/** Single-letter badge shown on the PDF canvas overlay. */
const TAG_LETTER: Record<CanvasTagKind, string> = {
  text: "T",
  table: "T",
  image: "I",
  qa: "Q",
  question: "Q",
  answer: "Q",
  math: "M",
  formula: "F",
};

const BLOCK_COLOR: Record<PdfBlockType, string> = {
  text: TAG_COLOR.text,
  heading: "#8b5cf6",
  list: "#06b6d4",
  table: TAG_COLOR.table,
  image: TAG_COLOR.image,
  qa: TAG_COLOR.qa,
};

const BLOCK_LABEL: Record<PdfBlockType, string> = {
  text: "Text",
  heading: "Heading",
  list: "List",
  table: "Table",
  image: "Image",
  qa: "Q & A",
};

const BLOCK_LETTER: Record<PdfBlockType, string> = {
  text: "T",
  heading: "H",
  list: "L",
  table: "T",
  image: "I",
  qa: "Q",
};

function isPlaceholderBlockContent(block: PdfBlock): boolean {
  if (isQaSegment(block)) return isQaPlaceholder(block);
  if (block.type === "image" || block.segmentTag === "image") {
    return block.type === "image" && !block.dataUrl;
  }
  if (!block.segmentTag) return false;

  const tag = block.segmentTag as CanvasTagKind;
  const title = block.title?.trim() ?? "";
  const content = block.content?.trim() ?? "";

  if (!content) return true;
  if (title && content === title) return true;
  if (content === TAG_LABEL[tag]) return true;
  if (tag === "formula" && (content === "$$\\cdots$$" || content === "\\ce{}" || content.startsWith("(formula"))) return true;
  if (tag === "math" && (content === "$$\\cdots$$" || content.startsWith("(math"))) return true;
  if (tag === "table" && content.includes("| Column 1 | Column 2 |")) return true;
  return false;
}

interface SelectionRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TagMenuState {
  screenX: number;
  screenY: number;
  selection: SelectionRect;
  tag: (typeof TAG_MENU_KINDS)[number];
  title: string;
  description: string;
}

export interface PdfCanvasEditorOptions {
  container: HTMLElement;
  fileName: string;
  pdfBytes: Uint8Array;
  doc: PdfDocumentBlocks;
  imageColorMode?: boolean;
  onChange?: (doc: PdfDocumentBlocks, markdown: string) => void;
  /** Optional GGUF provider for AI fix formula/math. */
  llmProvider?: GgufInferenceProvider | null;
  /** Active assist model id (defaults to session active / LFM2). */
  getAssistModelId?: () => string;
  onAssistProgress?: (message: string) => void;
}

export class PdfCanvasEditor {
  private readonly container: HTMLElement;
  private readonly fileName: string;
  private readonly pdfBytes: Uint8Array;
  private doc: PdfDocumentBlocks;
  private readonly onChange?: (doc: PdfDocumentBlocks, markdown: string) => void;
  private llmProvider: GgufInferenceProvider | null;
  private readonly getAssistModelId: () => string;
  private readonly onAssistProgress?: (message: string) => void;

  private currentPage = 0;
  private selectedId: string | null = null;
  private renderInfo: PageRenderInfo | null = null;

  private isDrawing = false;
  private drawStart: { x: number; y: number } | null = null;
  private liveRect: SelectionRect | null = null;
  private tagMenu: TagMenuState | null = null;
  private imageColorMode: boolean;
  private processingBlockIds = new Set<string>();
  private processingPage = false;
  private aiFixingIds = new Set<string>();
  /** Per-block newline collapse (annadata DocCanvasEditor wrap toggle). */
  private wrapTextIds = new Set<string>();
  private wrapOriginals = new Map<string, string>();

  private root!: HTMLElement;
  private wrapRef!: HTMLElement;
  private pageImg!: HTMLImageElement;
  private overlayLayer!: HTMLElement;
  private liveRectEl!: HTMLElement;
  private drawOverlay!: HTMLElement;
  private tagMenuEl!: HTMLElement;
  private blockPanel!: HTMLElement;
  private pageLabel!: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private lastRenderWidth = 0;
  private renderGeneration = 0;
  private resizeRaf = 0;

  constructor(options: PdfCanvasEditorOptions) {
    this.container = options.container;
    this.fileName = options.fileName;
    this.pdfBytes = options.pdfBytes;
    this.doc = options.doc;
    this.onChange = options.onChange;
    this.llmProvider = options.llmProvider ?? null;
    this.getAssistModelId = options.getAssistModelId ?? (() => getActiveModelId() || LFM2_CHAT_MODEL_ID);
    this.onAssistProgress = options.onAssistProgress;
    this.imageColorMode = options.imageColorMode ?? false;
    this.mount();
    void this.bootstrap();
  }

  setLlmProvider(provider: GgufInferenceProvider | null): void {
    this.llmProvider = provider;
  }

  private async bootstrap(): Promise<void> {
    this.normalizeQaBlocks();
    await this.renderCurrentPage(true);
    // Second pass after layout (Blocks panel may still be settling flex widths).
    requestAnimationFrame(() => {
      void this.renderCurrentPage();
    });
  }

  private normalizeQaBlocks(): void {
    let changed = false;
    const pages = { ...this.doc.pages };

    for (const [pageKey, page] of Object.entries(pages)) {
      const blocks = { ...page.blocks };
      for (const [blockId, block] of Object.entries(blocks)) {
        if (isQaSegment(block) && block.type !== "qa") {
          blocks[blockId] = asQaBlock(block);
          changed = true;
        }
      }
      pages[pageKey] = { ...page, blocks };
    }

    if (changed) {
      this.doc = { ...this.doc, pages };
      this.emitChange();
    }
  }

  private waitForPageImage(): Promise<void> {
    if (this.pageImg.complete && this.pageImg.naturalWidth > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.pageImg.addEventListener("load", () => resolve(), { once: true });
      this.pageImg.addEventListener("error", () => resolve(), { once: true });
    });
  }

  getDocument(): PdfDocumentBlocks {
    return this.doc;
  }

  setImageColorMode(on: boolean): void {
    this.imageColorMode = on;
    this.applyPageColorFilter();
  }

  private applyPageColorFilter(): void {
    this.pageImg.style.filter = this.imageColorMode ? "" : "grayscale(1)";
  }

  destroy(): void {
    this.renderGeneration++;
    if (this.resizeRaf) {
      cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.container.innerHTML = "";
  }

  private mount(): void {
    this.container.innerHTML = "";
    this.root = document.createElement("div");
    this.root.className = "pce-root";

    const toolbar = document.createElement("div");
    toolbar.className = "pce-toolbar";
    toolbar.innerHTML = `
      <div class="pce-page-nav">
        <button type="button" class="pce-nav-btn" data-nav="prev" aria-label="Previous page">‹</button>
        <span class="pce-page-label"></span>
        <button type="button" class="pce-nav-btn" data-nav="next" aria-label="Next page">›</button>
      </div>
    `;
    this.pageLabel = toolbar.querySelector(".pce-page-label")!;

    toolbar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-nav]");
      if (!btn) return;
      if (btn.dataset.nav === "prev" && this.currentPage > 0) {
        this.currentPage--;
        this.closeTagMenu();
        this.selectedId = null;
        this.lastRenderWidth = 0;
        void this.renderCurrentPage(true);
      }
      if (btn.dataset.nav === "next" && this.currentPage < this.doc.pageCount - 1) {
        this.currentPage++;
        this.closeTagMenu();
        this.selectedId = null;
        this.lastRenderWidth = 0;
        void this.renderCurrentPage(true);
      }
    });

    const layout = document.createElement("div");
    layout.className = "pce-layout";

    const canvasCol = document.createElement("div");
    canvasCol.className = "pce-canvas-col";

    this.wrapRef = document.createElement("div");
    this.wrapRef.className = "pce-canvas-wrap";

    this.pageImg = document.createElement("img");
    this.pageImg.className = "pce-page-img";
    this.pageImg.alt = "PDF page";
    this.pageImg.draggable = false;
    this.pageImg.addEventListener("load", () => {
      this.drawOverlays();
      this.updateLiveRect();
      this.syncBlockPanelHeight();
    });

    this.overlayLayer = document.createElement("div");
    this.overlayLayer.className = "pce-overlay-layer";

    this.liveRectEl = document.createElement("div");
    this.liveRectEl.className = "pce-selection-rect";
    this.liveRectEl.hidden = true;

    this.drawOverlay = document.createElement("div");
    this.drawOverlay.className = "pce-draw-overlay";
    this.drawOverlay.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.drawOverlay.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.drawOverlay.addEventListener("pointerup", (e) => this.onPointerUp(e));

    this.tagMenuEl = document.createElement("div");
    this.tagMenuEl.className = "pce-tag-menu";
    this.tagMenuEl.hidden = true;
    this.tagMenuEl.addEventListener("pointerdown", (e) => e.stopPropagation());

    this.wrapRef.append(
      this.pageImg,
      this.overlayLayer,
      this.liveRectEl,
      this.drawOverlay,
      this.tagMenuEl,
    );

    // Debounced + width-threshold: scrollbar/layout feedback must not re-render forever.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = 0;
        void this.renderCurrentPage();
      });
    });
    this.resizeObserver.observe(this.wrapRef);

    canvasCol.append(this.wrapRef);

    this.blockPanel = document.createElement("div");
    this.blockPanel.className = "pce-block-panel";

    layout.append(canvasCol, this.blockPanel);
    this.root.append(toolbar, layout);
    this.container.append(this.root);

    this.renderBlockPanel();
    this.updatePageNav();
  }

  private async renderCurrentPage(force = false): Promise<void> {
    // Prefer laid-out width. If the Blocks panel is still hidden / not measured,
    // wait for ResizeObserver instead of spinning RAF forever.
    const measured = Math.floor(this.wrapRef.clientWidth);
    if (measured < 40) {
      return;
    }

    const width = Math.max(320, measured - 4);
    // Ignore tiny width jitter (scrollbar appearing/disappearing).
    if (!force && this.lastRenderWidth > 0 && Math.abs(width - this.lastRenderWidth) < 12) {
      this.syncBlockPanelHeight();
      return;
    }

    const gen = ++this.renderGeneration;
    this.lastRenderWidth = width;
    this.pageImg.style.opacity = "0.5";
    try {
      const { dataUrl, info } = renderPdfPageDataUrl(this.pdfBytes, this.currentPage, width);
      if (gen !== this.renderGeneration) return;
      this.renderInfo = info;
      this.pageImg.src = dataUrl;
      this.applyPageColorFilter();
      await this.waitForPageImage();
      if (gen !== this.renderGeneration) return;
    } catch (err) {
      console.error("[PdfCanvasEditor] page render failed", err);
    } finally {
      if (gen === this.renderGeneration) this.pageImg.style.opacity = "1";
    }
    this.updatePageNav();
    this.renderBlockPanel();
    this.drawOverlays();
    this.syncBlockPanelHeight();
  }

  /** Match blocks column max-height to the loaded PDF canvas height. */
  private syncBlockPanelHeight(): void {
    const h = Math.round(this.wrapRef.getBoundingClientRect().height);
    if (h > 0) {
      this.root.style.setProperty("--pce-doc-height", `${h}px`);
    }
  }

  private updatePageNav(): void {
    this.pageLabel.textContent = `${this.currentPage + 1} / ${this.doc.pageCount}`;
    const prev = this.root.querySelector<HTMLButtonElement>('[data-nav="prev"]');
    const next = this.root.querySelector<HTMLButtonElement>('[data-nav="next"]');
    if (prev) prev.disabled = this.currentPage === 0;
    if (next) next.disabled = this.currentPage >= this.doc.pageCount - 1;
  }

  private getImageOffsetInWrap(): { ox: number; oy: number } {
    return { ox: this.pageImg.offsetLeft, oy: this.pageImg.offsetTop };
  }

  private getImagePos(e: PointerEvent): { x: number; y: number } {
    const ir = this.pageImg.getBoundingClientRect();
    const iw = Math.max(1, this.pageImg.offsetWidth);
    const ih = Math.max(1, this.pageImg.offsetHeight);
    return {
      x: Math.max(0, Math.min(iw, e.clientX - ir.left)),
      y: Math.max(0, Math.min(ih, e.clientY - ir.top)),
    };
  }

  private cssToPdfX(cssX: number): number {
    const info = this.renderInfo;
    if (!info) return 0;
    const iw = Math.max(1, this.pageImg.offsetWidth);
    return (cssX / iw) * info.pdfWidth;
  }

  private cssToPdfY(cssY: number): number {
    const info = this.renderInfo;
    if (!info) return 0;
    const ih = Math.max(1, this.pageImg.offsetHeight);
    return (cssY / ih) * info.pdfHeight;
  }

  private pdfToCssX(pdfX: number): number {
    const info = this.renderInfo;
    if (!info) return 0;
    const iw = Math.max(1, this.pageImg.offsetWidth);
    return this.pageImg.offsetLeft + (pdfX / info.pdfWidth) * iw;
  }

  private pdfToCssY(pdfY: number): number {
    const info = this.renderInfo;
    if (!info) return 0;
    const ih = Math.max(1, this.pageImg.offsetHeight);
    return this.pageImg.offsetTop + (pdfY / info.pdfHeight) * ih;
  }

  private selectionToBbox(sel: SelectionRect): PdfBBox {
    const x0 = this.cssToPdfX(Math.min(sel.x0, sel.x1));
    const y0 = this.cssToPdfY(Math.min(sel.y0, sel.y1));
    const x1 = this.cssToPdfX(Math.max(sel.x0, sel.x1));
    const y1 = this.cssToPdfY(Math.max(sel.y0, sel.y1));
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  private bboxToSelectionRect(bbox: PdfBBox): SelectionRect {
    const info = this.renderInfo;
    if (!info) {
      return { x0: 0, y0: 0, x1: 1, y1: 1 };
    }
    const iw = Math.max(1, this.pageImg.offsetWidth);
    const ih = Math.max(1, this.pageImg.offsetHeight);
    return {
      x0: (bbox.x / info.pdfWidth) * iw,
      y0: (bbox.y / info.pdfHeight) * ih,
      x1: ((bbox.x + bbox.w) / info.pdfWidth) * iw,
      y1: ((bbox.y + bbox.h) / info.pdfHeight) * ih,
    };
  }

  private blockTagLabel(block: PdfBlock): string {
    if (isQaSegment(block)) return TAG_LABEL.qa;
    if (block.segmentTag && block.segmentTag in TAG_LABEL) {
      return TAG_LABEL[block.segmentTag as CanvasTagKind];
    }
    return BLOCK_LABEL[block.type];
  }

  private blockTagLetter(block: PdfBlock): string {
    if (isQaSegment(block)) return TAG_LETTER.qa;
    if (block.segmentTag && block.segmentTag in TAG_LETTER) {
      return TAG_LETTER[block.segmentTag as CanvasTagKind];
    }
    return BLOCK_LETTER[block.type];
  }

  private blockTagColor(block: PdfBlock): string {
    if (isQaSegment(block)) return TAG_COLOR.qa;
    if (block.segmentTag && block.segmentTag in TAG_COLOR) {
      return TAG_COLOR[block.segmentTag as CanvasTagKind];
    }
    return BLOCK_COLOR[block.type];
  }

  private canToggleWrap(block: PdfBlock): boolean {
    return block.type !== "image" && block.type !== "table" && block.type !== "qa" && !isQaSegment(block);
  }

  private blockContentForProcessing(block: PdfBlock): PdfBlock {
    if (!this.wrapTextIds.has(block.id)) return block;
    const original = this.wrapOriginals.get(block.id);
    if (original === undefined) return block;
    return { ...block, content: original };
  }

  private applyWrapToPatch(blockId: string, patch: Partial<PdfBlock>): Partial<PdfBlock> {
    if (!this.wrapTextIds.has(blockId) || patch.content === undefined) return patch;
    const raw = String(patch.content);
    this.wrapOriginals.set(blockId, raw);
    return { ...patch, content: collapseNewlinesToSpaces(raw) };
  }

  private async processBlock(blockId: string, options?: { refresh?: boolean }): Promise<void> {
    const refresh = options?.refresh !== false;
    if (this.processingBlockIds.has(blockId)) return;

    const pageKey = blockId.match(/^p(\d+)-/)?.[1] ?? String(this.currentPage);
    const block = this.doc.pages[pageKey]?.blocks[blockId];
    if (!block) return;

    this.processingBlockIds.add(blockId);
    if (refresh) this.renderBlockPanel();

    try {
      if (block.type === "image" || block.segmentTag === "image") {
        const optimized = await this.cropBboxToOptimizedDataUrl(block.page, block.bbox);
        // Same idea as annadata-app SegmentProcessor: keep raster + searchable text.
        const { ocrText, searchPatternInImage } = extractImageRegionTextFromPdf(
          this.pdfBytes,
          block.page,
          block.bbox,
        );
        const imagePatch: Partial<PdfImageBlock> = {
          ocrText,
          searchPatternInImage,
        };
        if (optimized) {
          imagePatch.dataUrl = optimized.dataUrl;
          imagePatch.width = optimized.width;
          imagePatch.height = optimized.height;
        }
        this.patchBlock(blockId, imagePatch);
        return;
      }

      const patch = processBlockRegionFromPdf(this.pdfBytes, this.blockContentForProcessing(block));
      if (patch) {
        this.patchBlock(blockId, this.applyWrapToPatch(blockId, patch));
      }
    } finally {
      this.processingBlockIds.delete(blockId);
      if (refresh) this.renderBlockPanel();
    }
  }

  private async processCurrentPage(): Promise<void> {
    if (this.processingPage) return;
    const pageKey = String(this.currentPage);
    const page = this.doc.pages[pageKey];
    if (!page) {
      this.onAssistProgress?.("Page not found");
      return;
    }

    this.processingPage = true;
    this.renderBlockPanel();

    try {
      // Empty page → auto-detect & create blocks for this page only.
      // Existing regions → fill/process their content (OCR / image crop / etc.).
      if (page.order.length === 0) {
        this.onAssistProgress?.(
          `Auto-tagging page ${this.currentPage + 1}…`,
        );
        const extracted = await extractPdfPageBlocks(this.pdfBytes, this.currentPage, {
          sort: true,
        });
        const blocksMap: Record<string, PdfBlock> = {};
        const order: string[] = [];
        for (const block of extracted.blocks) {
          blocksMap[block.id] = block;
          order.push(block.id);
        }

        this.doc = {
          ...this.doc,
          pages: {
            ...this.doc.pages,
            [pageKey]: {
              width: extracted.width,
              height: extracted.height,
              blocks: blocksMap,
              order,
            },
          },
        };
        this.emitChange();
        this.onAssistProgress?.(
          `Page ${this.currentPage + 1} tagged · ${order.length} block(s)`,
        );
      } else {
        this.onAssistProgress?.(
          `Processing page ${this.currentPage + 1} · ${page.order.length} block(s)…`,
        );
        for (const blockId of page.order) {
          const block = this.doc.pages[pageKey]?.blocks[blockId];
          if (!block) continue;
          await this.processBlock(blockId, { refresh: false });
        }
        this.onAssistProgress?.(
          `Page ${this.currentPage + 1} processed · ${page.order.length} block(s)`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onAssistProgress?.(`Process Page failed: ${message}`);
      console.error("[PdfCanvasEditor] processCurrentPage", err);
    } finally {
      this.processingPage = false;
      this.renderBlockPanel();
      this.drawOverlays();
    }
  }

  private toggleWrapText(blockId: string): void {
    const pageKey = blockId.match(/^p(\d+)-/)?.[1] ?? String(this.currentPage);
    const block = this.doc.pages[pageKey]?.blocks[blockId];
    if (!block || !this.canToggleWrap(block)) return;

    if (this.wrapTextIds.has(blockId)) {
      const original = this.wrapOriginals.get(blockId);
      if (original !== undefined) {
        const lines = original.split("\n");
        this.patchBlock(blockId, { content: original, lines });
      }
      this.wrapOriginals.delete(blockId);
      this.wrapTextIds.delete(blockId);
    } else {
      const original = block.content ?? "";
      this.wrapOriginals.set(blockId, original);
      const wrapped = collapseNewlinesToSpaces(original);
      this.patchBlock(blockId, { content: wrapped, lines: [wrapped] });
      this.wrapTextIds.add(blockId);
    }

    this.renderBlockPanel();
  }

  private clearWrapState(blockId: string): void {
    this.wrapTextIds.delete(blockId);
    this.wrapOriginals.delete(blockId);
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.tagMenu) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.isDrawing = true;
    const pos = this.getImagePos(e);
    this.drawStart = pos;
    this.liveRect = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
    this.updateLiveRect();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDrawing || !this.drawStart) return;
    const pos = this.getImagePos(e);
    this.liveRect = {
      x0: this.drawStart.x,
      y0: this.drawStart.y,
      x1: pos.x,
      y1: pos.y,
    };
    this.updateLiveRect();
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.isDrawing || !this.drawStart) return;
    this.isDrawing = false;
    const pos = this.getImagePos(e);
    const sel: SelectionRect = {
      x0: Math.min(this.drawStart.x, pos.x),
      y0: Math.min(this.drawStart.y, pos.y),
      x1: Math.max(this.drawStart.x, pos.x),
      y1: Math.max(this.drawStart.y, pos.y),
    };
    this.liveRect = null;
    this.drawStart = null;
    this.updateLiveRect();

    if (sel.x1 - sel.x0 < 8 || sel.y1 - sel.y0 < 8) return;

    const { ox, oy } = this.getImageOffsetInWrap();
    this.openTagMenu({
      screenX: sel.x1 + ox,
      screenY: sel.y0 + oy,
      selection: sel,
      tag: "text",
      title: "",
      description: "",
    });
  }

  private updateLiveRect(): void {
    if (!this.liveRect) {
      this.liveRectEl.hidden = true;
      return;
    }
    const { ox, oy } = this.getImageOffsetInWrap();
    const x0 = Math.min(this.liveRect.x0, this.liveRect.x1) + ox;
    const y0 = Math.min(this.liveRect.y0, this.liveRect.y1) + oy;
    const w = Math.abs(this.liveRect.x1 - this.liveRect.x0);
    const h = Math.abs(this.liveRect.y1 - this.liveRect.y0);
    this.liveRectEl.hidden = false;
    this.liveRectEl.style.left = `${x0}px`;
    this.liveRectEl.style.top = `${y0}px`;
    this.liveRectEl.style.width = `${w}px`;
    this.liveRectEl.style.height = `${h}px`;
  }

  private closeTagMenu(): void {
    this.tagMenu = null;
    this.tagMenuEl.hidden = true;
    this.drawOverlay.style.pointerEvents = "";
  }

  private openTagMenu(state: TagMenuState): void {
    this.tagMenu = state;
    this.drawOverlay.style.pointerEvents = "none";
    this.renderTagMenu();
  }

  private renderTagMenu(): void {
    if (!this.tagMenu) {
      this.tagMenuEl.hidden = true;
      return;
    }

    const menu = this.tagMenu;
    const maxLeft = Math.max(0, this.wrapRef.clientWidth - 220);
    const maxTop = Math.max(0, this.wrapRef.clientHeight - 240);
    this.tagMenuEl.hidden = false;
    this.tagMenuEl.style.left = `${Math.min(menu.screenX + 4, maxLeft)}px`;
    this.tagMenuEl.style.top = `${Math.min(menu.screenY + 4, maxTop)}px`;
    this.tagMenuEl.innerHTML = "";

    const title = document.createElement("div");
    title.className = "pce-tag-menu-title";
    title.textContent = "Tag this region";
    this.tagMenuEl.append(title);

    const grid = document.createElement("div");
    grid.className = "pce-tag-grid";
    for (const kind of TAG_MENU_KINDS) {
      const btn = document.createElement("button");
      btn.type = "button";
      const selected = menu.tag === kind;
      btn.className = `pce-tag-btn${selected ? " selected" : ""}`;
      btn.textContent = TAG_LABEL[kind];
      btn.style.borderColor = TAG_COLOR[kind];
      btn.style.color = selected ? "#fff" : TAG_COLOR[kind];
      btn.style.background = selected ? TAG_COLOR[kind] : "transparent";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!this.tagMenu) return;
        this.tagMenu = { ...this.tagMenu, tag: kind };
        this.renderTagMenu();
      });
      grid.append(btn);
    }
    this.tagMenuEl.append(grid);

    const inputs = document.createElement("div");
    inputs.className = "pce-tag-inputs";

    const titleInput = document.createElement("input");
    titleInput.className = "pce-tag-input";
    titleInput.placeholder = "Title (optional)";
    titleInput.value = menu.title;
    titleInput.addEventListener("input", () => {
      if (this.tagMenu) this.tagMenu = { ...this.tagMenu, title: titleInput.value };
    });

    const descInput = document.createElement("input");
    descInput.className = "pce-tag-input";
    descInput.placeholder = "Description (optional)";
    descInput.value = menu.description;
    descInput.addEventListener("input", () => {
      if (this.tagMenu) this.tagMenu = { ...this.tagMenu, description: descInput.value };
    });

    inputs.append(titleInput, descInput);
    this.tagMenuEl.append(inputs);

    const actions = document.createElement("div");
    actions.className = "pce-tag-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pce-tag-btn-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeTagMenu();
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "pce-tag-btn-add";
    add.textContent = "Add";
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      this.commitDrawnBlock();
    });

    actions.append(cancel, add);
    this.tagMenuEl.append(actions);
  }

  private cropSelectionToCanvas(sel: SelectionRect): HTMLCanvasElement | undefined {
    if (!this.pageImg.complete || !this.pageImg.naturalWidth) return undefined;
    const scaleX = this.pageImg.naturalWidth / Math.max(1, this.pageImg.offsetWidth);
    const scaleY = this.pageImg.naturalHeight / Math.max(1, this.pageImg.offsetHeight);
    const sx = Math.min(sel.x0, sel.x1) * scaleX;
    const sy = Math.min(sel.y0, sel.y1) * scaleY;
    const sw = Math.max(1, Math.abs(sel.x1 - sel.x0) * scaleX);
    const sh = Math.max(1, Math.abs(sel.y1 - sel.y0) * scaleY);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(this.pageImg, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /**
   * Hi-DPI MuPDF re-render of the PDF bbox → trim margins / refine edges → WebP/JPEG.
   * Falls back to cropping the on-screen preview if the PDF region render fails.
   */
  private async cropBboxToOptimizedDataUrl(
    pageIndex: number,
    bbox: PdfBBox,
  ): Promise<{ dataUrl: string; width: number; height: number } | undefined> {
    let canvas: HTMLCanvasElement | undefined;
    try {
      canvas = renderPdfBboxToCanvas(this.pdfBytes, pageIndex, bbox, {
        maxEdge: 2000,
        maxZoom: 4,
      });
    } catch (err) {
      console.warn("[PdfCanvasEditor] hi-DPI PDF crop failed, using screen raster", err);
      canvas = this.cropSelectionToCanvas(this.bboxToSelectionRect(bbox));
    }
    if (!canvas) return undefined;
    try {
      return await optimizeImageCanvasToDataUrl(canvas, {
        colorMode: this.imageColorMode,
        maxEdge: 2000,
        webpQuality: 0.9,
        jpegQuality: 0.92,
        trimMargins: true,
        refineEdges: true,
      });
    } catch (err) {
      console.warn("[PdfCanvasEditor] image optimize failed, using jpeg fallback", err);
      return {
        dataUrl: canvas.toDataURL("image/jpeg", 0.92),
        width: canvas.width,
        height: canvas.height,
      };
    }
  }

  private commitDrawnBlock(): void {
    if (!this.tagMenu || !this.renderInfo) return;
    const { selection, tag, title, description } = this.tagMenu;
    const bbox = this.selectionToBbox(selection);
    const pageIndex = this.currentPage;
    const id = this.nextBlockId(pageIndex);
    const block = this.blockFromCanvasTag(tag, title, description, id, pageIndex, bbox, selection);

    this.insertBlock(block);
    this.selectedId = id;
    this.closeTagMenu();
    this.drawOverlays();
    this.renderBlockPanel();
    // Fill this tagged region immediately (OCR / table / formula / image crop).
    void this.processBlock(id);
    const card = this.blockPanel.querySelector(`[data-block-id="${id}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  private blockFromCanvasTag(
    tag: TagMenuState["tag"],
    title: string,
    description: string,
    id: string,
    pageIndex: number,
    bbox: PdfBBox,
    selection: SelectionRect,
  ): PdfBlock {
    const titleTrim = title.trim();
    const descTrim = description.trim();
    const combined = [titleTrim, descTrim].filter(Boolean).join("\n\n");
    const defaultCaption = titleTrim || `${TAG_LABEL[tag]} (${id})`;

    if (tag === "image") {
      // dataUrl filled by processBlock (denoise + compressed WebP/JPEG).
      const imageBlock: PdfImageBlock = {
        id,
        type: "image",
        page: pageIndex,
        bbox,
        content: defaultCaption,
        title: titleTrim || undefined,
        segmentTag: tag,
        width: Math.round(bbox.w),
        height: Math.round(bbox.h),
      };
      return imageBlock;
    }

    if (tag === "table") {
      const rows =
        descTrim.length > 0
          ? descTrim.split("\n").map((line) => line.split("|").map((c) => c.trim()).filter(Boolean))
          : [
              ["Column 1", "Column 2"],
              ["", ""],
            ];
      const tableBlock: PdfTableBlock = {
        id,
        type: "table",
        page: pageIndex,
        bbox,
        title: titleTrim || undefined,
        segmentTag: tag,
        rows,
        content: tableRowsToMarkdown(rows),
      };
      return tableBlock;
    }

    if (tag === "qa") {
      const initialQuestion = combined || titleTrim;
      const qaBlock: PdfQaBlock = {
        id,
        type: "qa",
        page: pageIndex,
        bbox,
        title: titleTrim || undefined,
        segmentTag: "qa",
        question: qaPart(initialQuestion),
        answer: qaPart(""),
        content: qaPartsToContent(initialQuestion, ""),
      };
      return qaBlock;
    }

    let content = combined;
    let contentFormat: PdfTextBlock["contentFormat"];
    if (tag === "formula") {
      content = combined || "\\ce{}";
      contentFormat = "mhchem";
    } else if (tag === "math") {
      content = combined || "$$\\cdots$$";
      contentFormat = "latex";
    } else if (!content) {
      content = titleTrim || TAG_LABEL[tag];
    }

    const textBlock: PdfTextBlock = {
      id,
      type: "text",
      page: pageIndex,
      bbox,
      title: titleTrim || undefined,
      segmentTag: tag,
      contentFormat,
      content,
      lines: content.split("\n"),
    };
    return textBlock;
  }

  private nextBlockId(pageIndex: number): string {
    const page = this.doc.pages[String(pageIndex)];
    let max = -1;
    for (const blockId of page?.order ?? []) {
      const match = blockId.match(/^p\d+-b(\d+)$/);
      if (match) max = Math.max(max, Number.parseInt(match[1]!, 10));
    }
    return `p${pageIndex}-b${max + 1}`;
  }

  private insertBlock(block: PdfBlock): void {
    const pageKey = String(block.page);
    const existing = this.doc.pages[pageKey];
    const page = existing ?? {
      width: this.renderInfo?.pdfWidth ?? 612,
      height: this.renderInfo?.pdfHeight ?? 792,
      blocks: {},
      order: [],
    };

    const blocks = { ...page.blocks, [block.id]: block };
    const order = sortBlocksByPosition(Object.values(blocks)).map((b) => b.id);

    this.doc = {
      ...this.doc,
      pages: {
        ...this.doc.pages,
        [pageKey]: { ...page, blocks, order },
      },
    };
    this.emitChange();
  }

  private removeBlock(blockId: string): void {
    const pageKey = blockId.match(/^p(\d+)-/)?.[1];
    if (!pageKey) return;
    const page = this.doc.pages[pageKey];
    if (!page) return;

    const { [blockId]: _removed, ...blocks } = page.blocks;
    const order = page.order.filter((id) => id !== blockId);
    this.doc = {
      ...this.doc,
      pages: {
        ...this.doc.pages,
        [pageKey]: { ...page, blocks, order },
      },
    };
    if (this.selectedId === blockId) this.selectedId = null;
    this.clearWrapState(blockId);
    this.emitChange();
    this.drawOverlays();
    this.renderBlockPanel();
  }

  private emitChange(): void {
    const markdown = blocksToMarkdown(this.doc);
    savePdfBlocksLocal(this.fileName, this.doc);
    this.onChange?.(this.doc, markdown);
  }

  private drawOverlays(): void {
    this.overlayLayer.innerHTML = "";
    const page = this.doc.pages[String(this.currentPage)];
    if (!page || !this.renderInfo) return;

    for (const blockId of page.order) {
      const block = page.blocks[blockId];
      if (!block) continue;

      const x0 = this.pdfToCssX(block.bbox.x);
      const y0 = this.pdfToCssY(block.bbox.y);
      const x1 = this.pdfToCssX(block.bbox.x + block.bbox.w);
      const y1 = this.pdfToCssY(block.bbox.y + block.bbox.h);

      const el = document.createElement("div");
      el.className = `pce-block-overlay${this.selectedId === block.id ? " selected" : ""}`;
      el.style.left = `${x0}px`;
      el.style.top = `${y0}px`;
      el.style.width = `${Math.max(4, x1 - x0)}px`;
      el.style.height = `${Math.max(4, y1 - y0)}px`;
      const tagLabel = this.blockTagLabel(block);
      const tagLetter = this.blockTagLetter(block);
      const tagColor = this.blockTagColor(block);
      el.style.borderColor = tagColor;
      el.style.color = tagColor;
      el.title = `${tagLabel}: ${block.id}`;

      const label = document.createElement("span");
      label.className = "pce-block-label";
      label.style.background = tagColor;
      label.title = tagLabel;
      label.append(document.createTextNode(tagLetter));

      const overlayRemove = document.createElement("button");
      overlayRemove.type = "button";
      overlayRemove.className = "pce-overlay-remove";
      overlayRemove.textContent = "×";
      overlayRemove.setAttribute("aria-label", `Remove ${block.id}`);
      overlayRemove.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeBlock(block.id);
      });
      label.append(overlayRemove);
      el.append(label);

      el.addEventListener("click", () => {
        this.selectedId = block.id;
        this.drawOverlays();
        this.renderBlockPanel();
        const card = this.blockPanel.querySelector(`[data-block-id="${block.id}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });

      this.overlayLayer.append(el);
    }
  }

  private renderBlockPanel(): void {
    this.blockPanel.innerHTML = "";

    const processBar = document.createElement("div");
    processBar.className = "pce-process-page-bar";

    const processPageBtn = document.createElement("button");
    processPageBtn.type = "button";
    processPageBtn.className = "pce-process-page-btn";
    processPageBtn.textContent = this.processingPage ? "Processing…" : "Process Page";
    processPageBtn.title = "Extract / fill content for all tagged regions on this page";
    processPageBtn.disabled = this.processingPage;
    processPageBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.processCurrentPage();
    });

    processBar.append(processPageBtn);
    this.blockPanel.append(processBar);

    const page = this.doc.pages[String(this.currentPage)];
    if (!page || page.order.length === 0) {
      this.blockPanel.append(document.createTextNode("No blocks on this page — draw a rectangle to add one."));
      return;
    }

    for (const blockId of page.order) {
      const block = page.blocks[blockId];
      if (!block) continue;
      this.blockPanel.append(this.createBlockCard(block));
    }
  }

  private createBlockCard(block: PdfBlock): HTMLElement {
    const card = document.createElement("article");
    card.className = `pce-block-card${this.selectedId === block.id ? " selected" : ""}`;
    card.dataset.blockId = block.id;

    const head = document.createElement("div");
    head.className = "pce-block-card-head";

    const tag = document.createElement("span");
    tag.className = "pce-tag";
    tag.style.background = this.blockTagColor(block);
    tag.textContent = this.blockTagLabel(block);

    const idSpan = document.createElement("span");
    idSpan.className = "pce-block-id";
    idSpan.textContent = block.id;

    const titleSpan = document.createElement("span");
    titleSpan.className = "pce-block-title";
    const titleText = block.title?.trim() ?? "";
    titleSpan.textContent = titleText;
    titleSpan.hidden = !titleText;

    const actions = document.createElement("div");
    actions.className = "pce-block-card-actions";

    const processBtn = document.createElement("button");
    processBtn.type = "button";
    processBtn.className = "pce-head-btn pce-head-btn--icon";
    const isProcessing = this.processingBlockIds.has(block.id);
    processBtn.title = "Process attached region";
    processBtn.setAttribute("aria-label", "Process attached region");
    processBtn.disabled = isProcessing;
    if (isProcessing) {
      processBtn.innerHTML = `<span class="pce-head-btn-busy" aria-hidden="true">…</span>`;
    } else {
      processBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>`;
    }
    processBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.processBlock(block.id);
    });
    actions.append(processBtn);

    if (this.canToggleWrap(block)) {
      const wrapOn = this.wrapTextIds.has(block.id);
      const wrapBtn = document.createElement("button");
      wrapBtn.type = "button";
      wrapBtn.className = `pce-wrap-toggle${wrapOn ? " pce-wrap-toggle-on" : ""}`;
      wrapBtn.title = wrapOn
        ? "Wrap ON — click to restore original line breaks"
        : "Click to collapse newlines to single spaces";
      wrapBtn.setAttribute("aria-label", wrapOn ? "Restore line breaks" : "Collapse newlines");
      wrapBtn.setAttribute("aria-pressed", String(wrapOn));
      wrapBtn.innerHTML = WRAP_TOGGLE_ICON_SVG;
      wrapBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleWrapText(block.id);
      });
      actions.append(wrapBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "pce-remove-btn";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove block";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeBlock(block.id);
    });

    actions.append(removeBtn);
    head.append(tag, idSpan, titleSpan, actions);
    card.append(head);

    if (block.type === "image") {
      const caption = document.createElement("input");
      caption.className = "pce-input";
      caption.value = block.content;
      caption.placeholder = "Image caption";
      caption.addEventListener("input", () => this.patchBlock(block.id, { content: caption.value }));
      card.append(caption);

      if (block.dataUrl) {
        const img = document.createElement("img");
        img.className = "pce-block-image";
        img.src = block.dataUrl;
        img.alt = block.content;
        card.append(img);
      }

      const ocrLabel = document.createElement("label");
      ocrLabel.className = "pce-image-ocr-label";
      ocrLabel.textContent = "Text in image";
      const ocrArea = document.createElement("textarea");
      ocrArea.className = "pce-textarea pce-image-ocr";
      ocrArea.rows = 4;
      ocrArea.placeholder = "Parsed text from this region (editable)";
      ocrArea.value = block.ocrText ?? "";
      ocrArea.addEventListener("click", (e) => e.stopPropagation());
      ocrArea.addEventListener("input", () => {
        const ocrText = ocrArea.value;
        this.patchBlock(block.id, {
          ocrText,
          searchPatternInImage: extractSearchTokensFromText(ocrText),
        });
      });
      card.append(ocrLabel, ocrArea);

      const tokens = block.searchPatternInImage ?? [];
      if (tokens.length > 0) {
        const tokenHint = document.createElement("div");
        tokenHint.className = "pce-image-ocr-tokens";
        tokenHint.title = tokens.join(", ");
        tokenHint.textContent = `${tokens.length} search token${tokens.length === 1 ? "" : "s"}`;
        card.append(tokenHint);
      }
    } else if (block.type === "table") {
      const tableBlock = block as PdfTableBlock;
      const area = document.createElement("textarea");
      area.className = "pce-textarea";
      area.rows = Math.min(12, tableBlock.rows.length + 2);
      area.value = tableBlock.content;
      area.addEventListener("input", () => {
        this.patchBlock(block.id, { content: area.value, rows: tableBlock.rows });
      });
      card.append(area);

      const syncBtn = document.createElement("button");
      syncBtn.type = "button";
      syncBtn.className = "pce-small-btn";
      syncBtn.textContent = "Sync rows → markdown";
      syncBtn.addEventListener("click", () => {
        const synced = syncTableBlockContent(tableBlock);
        this.patchBlock(block.id, synced);
        area.value = synced.content;
      });
      card.append(syncBtn);
    } else if (block.type === "qa" || isQaSegment(block)) {
      const qa = block.type === "qa" ? block : asQaBlock(block);
      card.classList.add("pce-block-card--qa");
      card.append(this.createQaSubBlocks(block.id, qa));
    } else if (block.segmentTag === "formula" || block.segmentTag === "math") {
      card.append(this.createFormulaEditor(block));
    } else {
      const area = document.createElement("textarea");
      area.className = "pce-textarea";
      area.rows = block.type === "heading" ? 2 : 6;
      area.value = block.content;
      area.addEventListener("input", () => this.patchBlock(block.id, { content: area.value }));
      card.append(area);
    }

    card.addEventListener("click", () => {
      this.selectedId = block.id;
      this.drawOverlays();
      this.blockPanel.querySelectorAll(".pce-block-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });

    return card;
  }

  private createFormulaEditor(block: PdfBlock): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "pce-formula-editor";

    const area = document.createElement("textarea");
    area.className = "pce-textarea";
    area.rows = 4;
    area.placeholder =
      block.segmentTag === "formula"
        ? "Chemistry — e.g. \\ce{Zn(s) + Cu^{2+}(aq) -> Zn^{2+}(aq) + Cu(s)}"
        : "Math — e.g. $$E = mc^{2}$$";
    area.value = block.content;
    area.addEventListener("click", (e) => e.stopPropagation());

    const preview = document.createElement("div");
    preview.className = "pce-formula-preview";
    const previewLabel = document.createElement("span");
    previewLabel.className = "pce-formula-preview-label";
    previewLabel.textContent = block.segmentTag === "formula" ? "Formula preview" : "Math preview";
    const previewBody = document.createElement("div");
    previewBody.className = "pce-formula-render";
    previewBody.setAttribute("aria-label", previewLabel.textContent);
    preview.append(previewLabel, previewBody);

    const refreshPreview = (content: string) => {
      const trimmed = content.trim();
      // Always show a preview for formula/math tags so OCR plain text is typeset
      // (wrapped as \\ce{…} / $$…$$), not left looking like a normal text block.
      preview.hidden = !trimmed;
      if (!trimmed) {
        previewBody.innerHTML = "";
        return;
      }

      let forPreview = content;
      const hasMarkup =
        containsMathOrChemistry(content) ||
        /\\ce\{|\\pu\{|\\frac|\\sqrt|\^{|_\{|\$/.test(content);

      if (!hasMarkup) {
        if (block.segmentTag === "formula") {
          // Plain chemistry / OCR → mhchem for KaTeX preview
          forPreview = `\\ce{${trimmed}}`;
        } else if (block.segmentTag === "math") {
          forPreview = `$$${trimmed}$$`;
        }
      }

      mountFormulaPreview(previewBody, forPreview, {
        displayMode: block.segmentTag === "formula" || forPreview.trim().startsWith("$$"),
      });
    };

    area.addEventListener("input", () => {
      const format = block.segmentTag === "formula" ? "mhchem" : "latex";
      this.patchBlock(block.id, {
        content: area.value,
        contentFormat: format,
        lines: area.value.split("\n"),
      });
      refreshPreview(area.value);
    });

    const actions = document.createElement("div");
    actions.className = "pce-formula-actions";
    const aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.className = "pce-small-btn pce-ai-fix-btn";
    const isFixing = this.aiFixingIds.has(block.id);
    aiBtn.disabled = isFixing;
    aiBtn.textContent = isFixing
      ? "AI fixing…"
      : block.segmentTag === "formula"
        ? "AI fix formula"
        : "AI fix math";
    aiBtn.title = this.llmProvider
      ? "Refine with the active GGUF chat model"
      : "Requires an LLM provider (download a chat model and ensure llama-cpp-pro is available)";
    aiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.aiFixBlock(block.id, area, refreshPreview, aiBtn);
    });
    actions.append(aiBtn);

    wrap.append(area, preview, actions);
    refreshPreview(block.content);
    return wrap;
  }

  private async aiFixBlock(
    blockId: string,
    area: HTMLTextAreaElement,
    refreshPreview: (content: string) => void,
    aiBtn: HTMLButtonElement,
  ): Promise<void> {
    if (this.aiFixingIds.has(blockId)) return;

    const pageKey = blockId.match(/^p(\d+)-/)?.[1] ?? String(this.currentPage);
    const block = this.doc.pages[pageKey]?.blocks[blockId];
    if (!block) return;

    if (!this.llmProvider) {
      this.onAssistProgress?.(
        "No LLM provider — install llama-cpp-pro (browser) or pass a GgufInferenceProvider",
      );
      return;
    }

    this.aiFixingIds.add(blockId);
    aiBtn.disabled = true;
    aiBtn.textContent = "AI fixing…";

    try {
      const plain = area.value.trim() || block.content;
      const modelId = this.getAssistModelId();
      const opts = {
        loadModelIfNeeded: true as const,
        modelId,
        onProgress: this.onAssistProgress,
      };

      let next: string | null = null;
      if (block.segmentTag === "formula") {
        next = await llmPlainToMhchem(plain, this.llmProvider, opts);
      } else if (block.segmentTag === "math") {
        next = await llmPlainToLatex(plain, this.llmProvider, opts);
      }

      if (next) {
        const format = block.segmentTag === "formula" ? "mhchem" : "latex";
        this.patchBlock(blockId, {
          content: next,
          contentFormat: format,
          lines: next.split("\n"),
        });
        area.value = next;
        refreshPreview(next);
        this.onAssistProgress?.("AI fix applied");
      } else {
        this.onAssistProgress?.("AI fix returned no result — keep rule-based content");
      }
    } finally {
      this.aiFixingIds.delete(blockId);
      this.renderBlockPanel();
    }
  }

  private createQaSubBlocks(blockId: string, qa: PdfQaBlock): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "pce-qa-block";

    const qSub = document.createElement("div");
    qSub.className = "pce-qa-sub pce-qa-sub--question";
    const qLabel = document.createElement("span");
    qLabel.className = "pce-qa-sub-label";
    qLabel.textContent = "Question";
    const qArea = document.createElement("textarea");
    qArea.className = "pce-textarea pce-qa-textarea";
    qArea.rows = 4;
    qArea.placeholder = "Question text";
    qArea.value = qa.question.content;
    qArea.addEventListener("input", () => {
      this.patchQaPart(blockId, "question", qArea.value);
    });
    qArea.addEventListener("click", (e) => e.stopPropagation());
    qSub.append(qLabel, qArea);

    const aSub = document.createElement("div");
    const answerEmpty = !qa.answer.content.trim();
    aSub.className = `pce-qa-sub pce-qa-sub--answer${answerEmpty ? " pce-qa-sub--empty" : ""}`;
    const aLabel = document.createElement("span");
    aLabel.className = "pce-qa-sub-label";
    aLabel.textContent = "Answer";
    const aArea = document.createElement("textarea");
    aArea.className = "pce-textarea pce-qa-textarea";
    aArea.rows = 4;
    aArea.placeholder = "Provide answer…";
    aArea.value = qa.answer.content;
    aArea.addEventListener("input", () => {
      this.patchQaPart(blockId, "answer", aArea.value);
      aSub.classList.toggle("pce-qa-sub--empty", !aArea.value.trim());
    });
    aArea.addEventListener("click", (e) => e.stopPropagation());
    aSub.append(aLabel, aArea);

    wrap.append(qSub, aSub);
    return wrap;
  }

  private patchQaPart(blockId: string, part: "question" | "answer", value: string): void {
    const pageKey = blockId.match(/^p(\d+)-/)?.[1] ?? String(this.currentPage);
    const existing = this.doc.pages[pageKey]?.blocks[blockId];
    if (!existing) return;

    const qa = existing.type === "qa" ? existing : asQaBlock(existing);
    const question = part === "question" ? value : qa.question.content;
    const answer = part === "answer" ? value : qa.answer.content;

    this.patchBlock(blockId, {
      type: "qa",
      segmentTag: "qa",
      question: qaPart(question),
      answer: qaPart(answer),
      content: qaPartsToContent(question, answer),
    });
  }

  private patchBlock(blockId: string, patch: Partial<PdfBlock>): void {
    const pageKey = blockId.match(/^p(\d+)-/)?.[1] ?? String(this.currentPage);
    const page = this.doc.pages[pageKey];
    if (!page) return;
    const existing = page.blocks[blockId];
    if (!existing) return;

    const next = { ...existing, ...patch } as PdfBlock;
    this.doc = {
      ...this.doc,
      pages: {
        ...this.doc.pages,
        [pageKey]: {
          ...page,
          blocks: { ...page.blocks, [blockId]: next },
        },
      },
    };
    this.emitChange();
  }
}
