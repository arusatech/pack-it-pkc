import { describe, expect, it } from "vitest";
import {
  buildFlashCardUnits,
  generateFlashCards,
  generateMcqsFromFlashCards,
} from "../src/pkc/study-cards.js";
import type { StudyBlock } from "../src/pkc/study-types.js";

describe("buildFlashCardUnits", () => {
  it("merges conversely-linked clauses into one unit", () => {
    const units = buildFlashCardUnits([
      "Chemical reactions can be used to produce electrical energy, conversely, electrical energy can be used to drive chemical changes.",
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatch(/conversely/i);
    expect(units[0]).toMatch(/\.$/);
  });

  it("merges a dependent continuation onto the previous sentence", () => {
    const units = buildFlashCardUnits([
      "Zinc displaces copper from copper sulfate solution.",
      "conversely, copper does not displace zinc under the same conditions.",
    ]);
    expect(units.length).toBe(1);
    expect(units[0]!.toLowerCase()).toContain("conversely");
    expect(units[0]).toMatch(/zinc/i);
  });
});

describe("generateFlashCards", () => {
  it("does not use What does this state prefix", async () => {
    const blocks: StudyBlock[] = [
      {
        id: "b1",
        page: 1,
        kind: "text",
        content:
          "Chemical reactions can be used to produce electrical energy, conversely, electrical energy can be used to drive chemical reactions. A galvanic cell converts chemical energy into electrical energy.",
        bbox: { x: 0, y: 0, w: 1, h: 1 },
      },
    ];
    const cards = await generateFlashCards(blocks, null);
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(c.info).not.toMatch(/^what does this state:/i);
      expect(c.solution.text.length).toBeGreaterThan(5);
      // Answers should not be mid-sentence truncations of the prompt.
      expect(c.solution.text.endsWith(" c")).toBe(false);
      expect(c.solution.text.endsWith(" to c")).toBe(false);
    }
  });

  it("builds MCQs from improved flash prompts", async () => {
    const blocks: StudyBlock[] = [
      {
        id: "b1",
        page: 1,
        kind: "text",
        content:
          "Oxidation is the loss of electrons. Reduction is the gain of electrons. The anode is the electrode where oxidation occurs. The cathode is the electrode where reduction occurs.",
        bbox: { x: 0, y: 0, w: 1, h: 1 },
      },
    ];
    const cards = await generateFlashCards(blocks, null);
    expect(cards.length).toBeGreaterThanOrEqual(4);
    const mcqs = generateMcqsFromFlashCards(cards);
    expect(mcqs.length).toBeGreaterThan(0);
    for (const m of mcqs) {
      expect(m.question).not.toMatch(/^what does this state:/i);
      expect(m.options).toHaveLength(4);
    }
  });
});
