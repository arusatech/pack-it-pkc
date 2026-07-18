import { describe, expect, it } from "vitest";
import {
  mergeStudyDocuments,
  mergeStudyPkcFiles,
} from "../src/pkc/merge-study-pkc.js";
import { packStudyPkc } from "../src/pkc/pack-study.js";
import { PKC_STUDY_VERSION, type PkcStudyDocument } from "../src/pkc/study-types.js";

function studyDoc(partial: Partial<PkcStudyDocument> & { title: string }): PkcStudyDocument {
  return {
    version: PKC_STUDY_VERSION,
    title: partial.title,
    source: partial.source ?? `${partial.title}.pdf`,
    createdAt: new Date().toISOString(),
    markdown: partial.markdown ?? `# ${partial.title}`,
    blocks: partial.blocks ?? [
      {
        id: "b1",
        page: 1,
        kind: "text",
        content: `block from ${partial.title}`,
        bbox: { x: 0, y: 0, w: 1, h: 1 },
      },
    ],
    chunks: partial.chunks ?? [
      {
        chunkId: "c1",
        blockId: "b1",
        page: 1,
        kind: "text",
        text: `chunk from ${partial.title}`,
        embedding: [0.1],
      },
    ],
    flashCards: partial.flashCards ?? [
      {
        id: "f1",
        blockId: "b1",
        page: 1,
        info: `flash ${partial.title}`,
        solution: { text: `sol ${partial.title}` },
      },
    ],
    mcqs: partial.mcqs ?? [
      {
        id: "q1",
        blockId: "b1",
        page: 1,
        question: `mcq ${partial.title}`,
        options: ["a", "b", "c", "d"],
        answerIndex: 0,
      },
    ],
    games: partial.games ?? [],
    models: partial.models ?? { embedding: null, chat: null },
    stats: partial.stats ?? {
      blockCount: 1,
      chunkCount: 1,
      embeddedChunkCount: 1,
      flashCardCount: 1,
      mcqCount: 1,
      gameCount: 0,
    },
  };
}

describe("mergeStudyDocuments", () => {
  it("merges flashCards and mcqs into their respective arrays", () => {
    const a = studyDoc({ title: "Alpha" });
    const b = studyDoc({ title: "Beta" });
    const merged = mergeStudyDocuments([
      { label: "alpha.study.pkc", document: a },
      { label: "beta.study.pkc", document: b },
    ]);

    expect(merged.flashCards).toHaveLength(2);
    expect(merged.mcqs).toHaveLength(2);
    expect(merged.flashCards.map((f) => f.info)).toEqual(["flash Alpha", "flash Beta"]);
    expect(merged.mcqs.map((m) => m.question)).toEqual(["mcq Alpha", "mcq Beta"]);
    expect(merged.stats.flashCardCount).toBe(2);
    expect(merged.stats.mcqCount).toBe(2);
    // ids remapped to avoid collisions
    expect(merged.flashCards[0]!.id).toBe("m0_f1");
    expect(merged.flashCards[1]!.id).toBe("m1_f1");
    expect(merged.mcqs[0]!.id).toBe("m0_q1");
    expect(merged.mcqs[1]!.id).toBe("m1_q1");
  });

  it("defaults title/source to the first document", () => {
    const merged = mergeStudyDocuments([
      { label: "first.study.pkc", document: studyDoc({ title: "First" }) },
      { label: "second.study.pkc", document: studyDoc({ title: "Second" }) },
    ]);
    expect(merged.title).toBe("First");
    expect(merged.source).toBe("first.study.pkc");
    expect(merged.markdown).toContain("Merged from: first.study.pkc");
    expect(merged.markdown).toContain("Merged from: second.study.pkc");
  });

  it("rejects fewer than 2 sources", () => {
    expect(() =>
      mergeStudyDocuments([{ label: "only.study.pkc", document: studyDoc({ title: "Only" }) }]),
    ).toThrow(/at least 2/i);
  });
});

describe("mergeStudyPkcFiles", () => {
  it("round-trips packed bytes and names after the first file by default", () => {
    const a = packStudyPkc(studyDoc({ title: "Chapter1" }));
    const b = packStudyPkc(studyDoc({ title: "Chapter2" }));
    const { document, pkc, filename } = mergeStudyPkcFiles([
      { label: "chapter1.study.pkc", bytes: a },
      { label: "chapter2.study.pkc", bytes: b },
    ]);

    expect(filename).toBe("chapter1.study.pkc");
    expect(document.flashCards).toHaveLength(2);
    expect(document.mcqs).toHaveLength(2);
    expect(pkc.byteLength).toBeGreaterThan(32);
  });

  it("uses outputBaseName when provided", () => {
    const a = packStudyPkc(studyDoc({ title: "A" }));
    const b = packStudyPkc(studyDoc({ title: "B" }));
    const { filename } = mergeStudyPkcFiles(
      [
        { label: "a.study.pkc", bytes: a },
        { label: "b.study.pkc", bytes: b },
      ],
      { outputBaseName: "combined-unit" },
    );
    expect(filename).toBe("combined-unit.study.pkc");
  });
});
