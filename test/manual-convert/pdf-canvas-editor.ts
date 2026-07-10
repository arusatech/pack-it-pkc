import type {
  PdfBlock,
  PdfBlockType,
  PdfBBox,
  PdfDocumentBlocks,
  PdfImageBlock,
  PdfTableBlock,
  PdfTextBlock,
} from "../../src/convert/pdf/pdf-block-types.js";
import { sortBlocksByPosition } from "../../src/convert/pdf/pdf-block-types.js";
import { blocksToMarkdown, syncTableBlockContent, tableRowsToMarkdown } from "../../src/convert/pdf/pdf-blocks-to-markdown.js";
import { savePdfBlocksLocal } from "./pdf-blocks-local-storage.js";
import { processBlockRegionFromPdf } from "./pdf-block-region-processor.js";
import { collapseNewlinesToSpaces, WRAP_TOGGLE_ICON_SVG } from "./pdf-block-text-wrap.js";
import { renderPdfPageDataUrl, type PageRenderInfo } from "./pdf-page-renderer.js";

type CanvasTagKind = "text" | "table" | "image" | "question" | "answer" | "formula";

const TAG_KINDS: CanvasTagKind[] = ["text", "table", "image", "question", "answer", "formula"];

const TAG_COLOR: Record<CanvasTagKind, string> = {
  text: "#3880ff",
  table: "#ffc409",
  image: "#7044ff",
  question: "#2dd36f",
  answer: "#06b6d4",
  formula: "#eb445a",
};

const TAG_LABEL: Record<CanvasTagKind, string> = {
  text: "Text",
  table: "Table",
  image: "Image",
  question: "Question",
  answer: "Answer",
  formula: "Formula",
};

const BLOCK_COLOR: Record<PdfBlockType, string> = {
  text: TAG_COLOR.text,
  heading: "#8b5cf6",
  list: "#06b6d4",
  table: TAG_COLOR.table,
  image: TAG_COLOR.image,
};

const BLOCK_LABEL: Record<PdfBlockType, string> = {
  text: "Text",
  heading: "Heading",
  list: "List",
  table: "Table",
  image: "Image",
};

function isPlaceholderBlockContent(block: PdfBlock): boolean {
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
  if (tag === "question" && content === "**Q:** ") return true;
  if (tag === "answer" && content === "**A:** ") return true;
  if (tag === "formula" && content === "$$\\cdots$$") return true;
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
  tag: CanvasTagKind;
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
}

export class PdfCanvasEditor {
  private readonly container: HTMLElement;
  private readonly fileName: string;
  private readonly pdfBytes: Uint8Array;
  private doc: PdfDocumentBlocks;
  private readonly onChange?: (doc: PdfDocumentBlocks, markdown: string) => void;

  private currentPage = 0;
  private selectedId: string | null = null;
  private renderInfo: PageRenderInfo | null = null;

  private isDrawing = false;
  private drawStart: { x: number; y: number } | null = null;
  private liveRect: SelectionRect | null = null;
  private tagMenu: TagMenuState | null = null;
  private imageColorMode: boolean;
  private processingBlockIds = new Set<string>();
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

  constructor(options: PdfCanvasEditorOptions) {
    this.container = options.container;
    this.fileName = options.fileName;
    this.pdfBytes = options.pdfBytes;
    this.doc = options.doc;
    this.onChange = options.onChange;
    this.imageColorMode = options.imageColorMode ?? false;
    this.mount();
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    await this.renderCurrentPage();
    await this.processAllPendingBlocks();
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
        void this.renderCurrentPage();
      }
      if (btn.dataset.nav === "next" && this.currentPage < this.doc.pageCount - 1) {
        this.currentPage++;
        this.closeTagMenu();
        this.selectedId = null;
        void this.renderCurrentPage();
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

    const resizeObserver = new ResizeObserver(() => {
      void this.renderCurrentPage();
    });
    resizeObserver.observe(this.wrapRef);

    canvasCol.append(this.wrapRef);

    this.blockPanel = document.createElement("div");
    this.blockPanel.className = "pce-block-panel";

    layout.append(canvasCol, this.blockPanel);
    this.root.append(toolbar, layout);
    this.container.append(this.root);

    this.renderBlockPanel();
    this.updatePageNav();
  }

  private async renderCurrentPage(): Promise<void> {
    const width = Math.max(320, this.wrapRef.clientWidth - 4);
    if (width < 10) {
      requestAnimationFrame(() => void this.renderCurrentPage());
      return;
    }

    this.pageImg.style.opacity = "0.5";
    try {
      const { dataUrl, info } = renderPdfPageDataUrl(this.pdfBytes, this.currentPage, width);
      this.renderInfo = info;
      this.pageImg.src = dataUrl;
      this.applyPageColorFilter();
      await this.waitForPageImage();
    } catch (err) {
      console.error("[PdfCanvasEditor] page render failed", err);
    } finally {
      this.pageImg.style.opacity = "1";
    }
    this.updatePageNav();
    this.renderBlockPanel();
    this.drawOverlays();
    await this.processPendingImagesOnCurrentPage({ refresh: false });
    this.renderBlockPanel();
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
    if (block.segmentTag && block.segmentTag in TAG_LABEL) {
      return TAG_LABEL[block.segmentTag as CanvasTagKind];
    }
    return BLOCK_LABEL[block.type];
  }

  private blockTagColor(block: PdfBlock): string {
    if (block.segmentTag && block.segmentTag in TAG_COLOR) {
      return TAG_COLOR[block.segmentTag as CanvasTagKind];
    }
    return BLOCK_COLOR[block.type];
  }

  private canToggleWrap(block: PdfBlock): boolean {
    return block.type !== "image" && block.type !== "table";
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
        const dataUrl = this.cropSelectionToDataUrl(this.bboxToSelectionRect(block.bbox));
        if (dataUrl) {
          this.patchBlock(blockId, {
            dataUrl,
            width: Math.round(block.bbox.w),
            height: Math.round(block.bbox.h),
          });
        }
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

  private async processAllPendingBlocks(): Promise<void> {
    for (const page of Object.values(this.doc.pages)) {
      for (const blockId of page.order) {
        const block = page.blocks[blockId];
        if (!block || !isPlaceholderBlockContent(block)) continue;
        if (block.type === "image" || block.segmentTag === "image") continue;
        await this.processBlock(blockId, { refresh: false });
      }
    }
    this.renderBlockPanel();
  }

  private async processPendingImagesOnCurrentPage(options?: { refresh?: boolean }): Promise<void> {
    const page = this.doc.pages[String(this.currentPage)];
    if (!page) return;

    for (const blockId of page.order) {
      const block = page.blocks[blockId];
      if (!block || (block.type !== "image" && block.segmentTag !== "image")) continue;
      if (!isPlaceholderBlockContent(block)) continue;
      await this.processBlock(blockId, options);
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
    e.currentTarget.setPointerCapture(e.pointerId);
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
    for (const kind of TAG_KINDS) {
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

  private cropSelectionToDataUrl(sel: SelectionRect): string | undefined {
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
    return canvas.toDataURL("image/png");
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
    void this.processBlock(id);
    const card = this.blockPanel.querySelector(`[data-block-id="${id}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  private blockFromCanvasTag(
    tag: CanvasTagKind,
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
      const dataUrl = this.cropSelectionToDataUrl(selection);
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
        dataUrl,
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

    let content = combined;
    if (tag === "question") {
      content = combined || "**Q:** ";
    } else if (tag === "answer") {
      content = combined || "**A:** ";
    } else if (tag === "formula") {
      content = combined || "$$\\cdots$$";
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
      el.style.borderColor = BLOCK_COLOR[block.type];
      el.title = `${BLOCK_LABEL[block.type]}: ${block.id}`;

      const label = document.createElement("span");
      label.className = "pce-block-label";
      label.style.background = BLOCK_COLOR[block.type];
      label.append(document.createTextNode(BLOCK_LABEL[block.type]));

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
    const header = document.createElement("div");
    header.className = "pce-panel-header";
    header.innerHTML =
      `<strong>Blocks</strong><span class="pce-panel-hint">draw on page to add · click overlay to select</span>`;
    this.blockPanel.append(header);

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
