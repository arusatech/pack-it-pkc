import { describe, expect, it } from "vitest";
import {
  assessStudyRetrievalRelevance,
  lexicalOverlapRatio,
} from "../src/pkc/study-chat/relevance.js";

describe("lexicalOverlapRatio", () => {
  it("rejects Pythagoras vs electrochemistry passage", () => {
    const electro =
      "A galvanic cell converts chemical energy into electrical energy. " +
      "The Daniell cell uses zinc and copper electrodes in sulfate solutions.";
    expect(lexicalOverlapRatio("Pythagarus theorem", electro)).toBe(0);
    expect(lexicalOverlapRatio("Pythagoras theorem", electro)).toBe(0);
  });

  it("accepts fuzzy misspelling when the term is in the passage", () => {
    const math =
      "The Pythagoras theorem states that a squared plus b squared equals c squared.";
    expect(lexicalOverlapRatio("Pythagarus theorem", math)).toBeGreaterThanOrEqual(0.5);
  });
});

describe("assessStudyRetrievalRelevance", () => {
  it("marks off-topic ANN neighbors as not relevant", () => {
    const ranked = [
      {
        chunkId: "c1",
        text: "Zinc dissolves at the anode in a Daniell cell.",
        score: 0.9,
        vectorScore: 0.22,
      },
    ];
    const r = assessStudyRetrievalRelevance("Pythagoras theorem", ranked);
    expect(r.relevant).toBe(false);
    expect(r.reason).toBe("none");
  });

  it("accepts strong vector paraphrase", () => {
    const ranked = [
      {
        chunkId: "c1",
        text: "In a right triangle the square on the hypotenuse equals the sum of squares on the other sides.",
        score: 0.8,
        vectorScore: 0.62,
      },
    ];
    const r = assessStudyRetrievalRelevance("Pythagorean theorem", ranked);
    expect(r.relevant).toBe(true);
    expect(r.reason).toBe("vector");
  });
});
