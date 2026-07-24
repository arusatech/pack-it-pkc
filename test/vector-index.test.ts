import { describe, expect, it } from "vitest";
import { ExactCosineIndex } from "../src/pkc/vector/exact-cosine-index.js";
import { createStudyVectorIndex } from "../src/pkc/vector/create-index.js";

function unit(vec: number[]): number[] {
  const n = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / n);
}

describe("ExactCosineIndex", () => {
  it("returns nearest neighbors by cosine similarity", () => {
    const index = new ExactCosineIndex(3);
    index.add([
      { chunkId: "a", text: "alpha", embedding: unit([1, 0, 0]) },
      { chunkId: "b", text: "beta", embedding: unit([0, 1, 0]) },
      { chunkId: "c", text: "gamma", embedding: unit([0.9, 0.1, 0]) },
    ]);
    const hits = index.search(unit([1, 0, 0]), 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.chunkId).toBe("a");
    expect(hits[0]!.score).toBeCloseTo(1, 5);
    expect(hits[1]!.chunkId).toBe("c");
    expect(hits[1]!.score).toBeGreaterThan(0.9);
  });
});

describe("createStudyVectorIndex", () => {
  it("builds a working index (usearch or exact-cosine)", async () => {
    const index = await createStudyVectorIndex(4);
    expect(["usearch", "exact-cosine"]).toContain(index.backend);
    index.add([
      { chunkId: "x", text: "one", embedding: unit([1, 0, 0, 0]) },
      { chunkId: "y", text: "two", embedding: unit([0, 1, 0, 0]) },
    ]);
    const hits = index.search(unit([1, 0, 0, 0]), 1);
    expect(hits[0]?.chunkId).toBe("x");
    expect(hits[0]!.score).toBeGreaterThan(0.99);
  });
});
