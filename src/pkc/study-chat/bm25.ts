/**
 * In-memory FlexSearch keyword index for Study PKC retrieval (annadata BM25Service pattern).
 */

import { Document } from "flexsearch";

export interface Bm25Hit {
  chunkId: string;
  text: string;
  score: number;
}

type Bm25Doc = {
  id: string;
  text: string;
  [key: string]: string;
};

interface IndexEntry {
  index: Document<Bm25Doc>;
  texts: Map<string, string>;
}

export class StudyBm25Index {
  private readonly indexes = new Map<string, IndexEntry>();

  buildIndex(docId: string, chunks: Array<{ chunkId: string; text: string }>): void {
    const index = new Document<Bm25Doc>({
      tokenize: "forward",
      document: {
        id: "id",
        index: ["text"],
      },
    });

    const texts = new Map<string, string>();
    for (const chunk of chunks) {
      const text = chunk.text ?? "";
      texts.set(chunk.chunkId, text);
      index.add(chunk.chunkId, { id: chunk.chunkId, text });
    }

    this.indexes.set(docId, { index, texts });
  }

  search(docId: string, query: string, limit: number): Bm25Hit[] {
    const entry = this.indexes.get(docId);
    if (!entry || limit <= 0) return [];

    const trimmed = (query ?? "").trim();
    if (!trimmed) return [];

    const raw = entry.index.search(trimmed, { limit }) as unknown;
    const orderedIds = collectOrderedIds(raw, limit);
    if (orderedIds.length === 0) return [];

    const count = orderedIds.length;
    return orderedIds.map((chunkId, rank) => ({
      chunkId,
      text: entry.texts.get(chunkId) ?? "",
      score: (count - rank) / count,
    }));
  }

  clear(docId: string): void {
    this.indexes.delete(docId);
  }

  has(docId: string): boolean {
    return this.indexes.has(docId);
  }
}

/** Shared singleton for process-lifetime indexes keyed by study doc identity. */
export const studyBm25 = new StudyBm25Index();

function collectOrderedIds(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  const ordered: string[] = [];
  const seen = new Set<string>();

  const pushId = (value: unknown): void => {
    if (ordered.length >= limit) return;
    const id = toId(value);
    if (id === null || seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };

  for (const element of raw) {
    if (ordered.length >= limit) break;
    extractIds(element).forEach(pushId);
  }
  return ordered;
}

function extractIds(element: unknown): unknown[] {
  if (element && typeof element === "object") {
    const obj = element as Record<string, unknown>;
    if (Array.isArray(obj.result)) return obj.result.map(unwrapId);
    if ("id" in obj) return [obj.id];
  }
  return [element];
}

function unwrapId(item: unknown): unknown {
  if (item && typeof item === "object" && "id" in (item as Record<string, unknown>)) {
    return (item as Record<string, unknown>).id;
  }
  return item;
}

function toId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}
