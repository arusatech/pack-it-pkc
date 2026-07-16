/**
 * Attach diagram images from Study PKC blocks to chat replies (annadata pkcChatImages pattern).
 */

import type { PkcStudyDocument, StudyBlock } from "../study-types.js";
import type { RankedChunk } from "./hybrid.js";

export interface StudyChatImage {
  src: string;
  caption?: string;
  blockId?: string;
}

function imageBlocks(doc: PkcStudyDocument): StudyBlock[] {
  return (doc.blocks ?? []).filter(
    (b) => b.kind === "image" && typeof b.dataUrl === "string" && b.dataUrl.startsWith("data:image/"),
  );
}

function chunkMeta(
  doc: PkcStudyDocument,
  chunkId: string,
): { page?: number; blockId?: string } {
  if (chunkId.startsWith("flash:")) {
    const id = chunkId.slice("flash:".length);
    const fc = doc.flashCards?.find((c) => c.id === id);
    return { page: fc?.page, blockId: fc?.blockId };
  }
  if (chunkId.startsWith("mcq:")) {
    const id = chunkId.slice("mcq:".length);
    const m = doc.mcqs?.find((c) => c.id === id);
    return { page: m?.page, blockId: m?.blockId };
  }
  const chunk = doc.chunks?.find((c) => c.chunkId === chunkId);
  return { page: chunk?.page, blockId: chunk?.blockId };
}

/**
 * Resolve up to `maxImages` data-URL figures related to retrieved chunks:
 * same-page image blocks, flash solution imageIds, and direct block matches.
 */
export function resolveStudyChatImages(
  doc: PkcStudyDocument,
  rankedChunks: RankedChunk[],
  maxImages = 3,
): StudyChatImage[] {
  const images = imageBlocks(doc);
  if (!images.length || !rankedChunks.length) return [];

  const byId = new Map(images.map((b) => [b.id, b]));
  const byPage = new Map<number, StudyBlock[]>();
  for (const img of images) {
    const list = byPage.get(img.page) ?? [];
    list.push(img);
    byPage.set(img.page, list);
  }

  const seen = new Set<string>();
  const out: StudyChatImage[] = [];

  const tryAdd = (block: StudyBlock | undefined, caption?: string) => {
    if (!block?.dataUrl || seen.has(block.dataUrl) || out.length >= maxImages) return;
    seen.add(block.dataUrl);
    out.push({
      src: block.dataUrl,
      caption: caption || block.title || "Figure",
      blockId: block.id,
    });
  };

  for (const ranked of rankedChunks) {
    if (out.length >= maxImages) break;
    const meta = chunkMeta(doc, ranked.chunkId);

    // Flash card explicit image ids
    if (ranked.chunkId.startsWith("flash:")) {
      const id = ranked.chunkId.slice("flash:".length);
      const fc = doc.flashCards?.find((c) => c.id === id);
      for (const imageId of fc?.solution?.imageIds ?? []) {
        tryAdd(byId.get(imageId), fc?.info?.slice(0, 80));
      }
    }

    // Same-page diagrams as the retrieved text chunk
    if (meta.page != null) {
      for (const img of byPage.get(meta.page) ?? []) {
        tryAdd(img, img.title || `Figure (page ${meta.page})`);
      }
    }

    // Direct block id match (rare but useful)
    if (meta.blockId) {
      tryAdd(byId.get(meta.blockId));
    }
  }

  return out;
}
