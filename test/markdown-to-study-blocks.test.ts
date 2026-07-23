import { describe, expect, it } from "vitest";
import { markdownToStudyBlocks } from "../src/pkc/markdown-to-study-blocks.js";

describe("markdownToStudyBlocks", () => {
  it("maps headings, paragraphs, lists, and tables", () => {
    const md = [
      "# Title",
      "",
      "Hello world paragraph.",
      "",
      "- item one",
      "- item two",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");

    const doc = markdownToStudyBlocks(md, { title: "Sample" });
    expect(doc.version).toBe(1);
    expect(doc.title).toBe("Sample");
    expect(doc.pageCount).toBe(1);
    const page = doc.pages["0"]!;
    expect(page.order.length).toBe(4);

    const blocks = page.order.map((id) => page.blocks[id]!);
    expect(blocks[0]!.type).toBe("heading");
    expect(blocks[0]!.content).toBe("Title");
    expect(blocks[1]!.type).toBe("text");
    expect(blocks[1]!.content).toContain("Hello world");
    expect(blocks[2]!.type).toBe("list");
    expect(blocks[3]!.type).toBe("table");
    if (blocks[3]!.type === "table") {
      expect(blocks[3]!.rows.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns empty page for blank markdown", () => {
    const doc = markdownToStudyBlocks("   ");
    expect(doc.pages["0"]!.order).toEqual([]);
  });
});
