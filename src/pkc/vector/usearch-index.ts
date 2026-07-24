/**
 * USearch-backed study vector index (Node native bindings via `usearch` npm).
 * Cosine metric; distances are converted to similarity scores (1 - distance).
 */

import {
  USEARCH_CONNECTIVITY,
  USEARCH_EXPANSION_ADD,
  USEARCH_EXPANSION_SEARCH,
} from "../study-rag-config.js";
import type { StudyVectorHit, StudyVectorIndex, StudyVectorRecord } from "./types.js";

type USearchIndexCtor = new (config: {
  dimensions: number;
  metric: string;
  connectivity?: number;
  expansion_add?: number;
  expansion_search?: number;
}) => {
  add(key: bigint, vector: Float32Array): void;
  search(
    vector: Float32Array,
    k: number,
  ): { keys: BigUint64Array; distances: Float32Array };
  size(): number | bigint;
  remove?(key: bigint): void;
};

function isNodeRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    typeof process.versions.node === "string"
  );
}

export class USearchVectorIndex implements StudyVectorIndex {
  readonly backend = "usearch" as const;
  readonly dimensions: number;

  private readonly index: InstanceType<USearchIndexCtor>;
  private chunkIds: string[] = [];
  private texts: string[] = [];
  private nextKey = 0;

  private constructor(dimensions: number, Index: USearchIndexCtor) {
    this.dimensions = dimensions;
    this.index = new Index({
      dimensions,
      metric: "cos",
      connectivity: USEARCH_CONNECTIVITY,
      expansion_add: USEARCH_EXPANSION_ADD,
      expansion_search: USEARCH_EXPANSION_SEARCH,
    });
  }

  /** Returns null when native bindings are unavailable (browser / failed install). */
  static async tryCreate(dimensions: number): Promise<USearchVectorIndex | null> {
    if (!isNodeRuntime()) return null;
    if (!(dimensions > 0)) {
      throw new Error(`USearchVectorIndex: dimensions must be > 0 (got ${dimensions})`);
    }
    try {
      // Function-based import so Vite/Rollup do not resolve the Node native addon.
      const load = new Function("id", "return import(id)") as (id: string) => Promise<{
        Index?: USearchIndexCtor;
        default?: { Index: USearchIndexCtor };
      }>;
      const mod = await load("usearch");
      const Index = mod.Index ?? mod.default?.Index;
      if (!Index) return null;
      return new USearchVectorIndex(dimensions, Index);
    } catch {
      return null;
    }
  }

  size(): number {
    const s = this.index.size();
    return typeof s === "bigint" ? Number(s) : s;
  }

  clear(): void {
    if (typeof this.index.remove === "function") {
      for (let i = 0; i < this.nextKey; i++) {
        try {
          this.index.remove!(BigInt(i));
        } catch {
          /* key may already be gone */
        }
      }
    }
    this.chunkIds = [];
    this.texts = [];
    this.nextKey = 0;
  }

  add(records: StudyVectorRecord[]): void {
    const dim = this.dimensions;
    for (const r of records) {
      if (!Array.isArray(r.embedding) || r.embedding.length !== dim) continue;
      const key = this.nextKey;
      const vec = Float32Array.from(r.embedding);
      this.index.add(BigInt(key), vec);
      this.chunkIds[key] = r.chunkId;
      this.texts[key] = r.text;
      this.nextKey += 1;
    }
  }

  search(query: number[], k: number): StudyVectorHit[] {
    if (k <= 0 || this.size() === 0) return [];
    if (query.length !== this.dimensions) return [];
    const vec = Float32Array.from(query);
    const result = this.index.search(vec, Math.min(k, Math.max(1, this.size())));
    const hits: StudyVectorHit[] = [];
    const keys = result.keys;
    const distances = result.distances;
    const n = Math.min(keys.length, distances.length);
    for (let i = 0; i < n; i++) {
      const key = Number(keys[i]!);
      const chunkId = this.chunkIds[key];
      if (!chunkId) continue;
      const distance = distances[i]!;
      const score = 1 - distance;
      hits.push({
        chunkId,
        text: this.texts[key] ?? "",
        score,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits;
  }
}
