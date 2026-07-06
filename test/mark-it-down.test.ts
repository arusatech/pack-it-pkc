import { describe, it, expect } from "vitest";
import { MarkItDown } from "../src/convert/mark-it-down.js";
import { packToPkc, unpackPkc } from "../src/pkc/pack.js";
import { detectFromMagicBytes } from "../src/detect/magic-bytes.js";
import { ByteStream } from "../src/utils/byte-stream.js";

describe("detect", () => {
  it("detects PDF magic bytes", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(detectFromMagicBytes(bytes)?.ext).toBe(".pdf");
  });
});

describe("PlainTextConverter", () => {
  it("converts markdown", async () => {
    const md = new MarkItDown();
    const text = "# Hello\n\nWorld";
    const result = await md.convertBytes(new TextEncoder().encode(text), {
      extension: ".md",
      mimetype: "text/markdown",
    });
    expect(result.markdown).toContain("# Hello");
  });
});

describe("CsvConverter", () => {
  it("converts CSV to markdown table", async () => {
    const md = new MarkItDown();
    const csv = "name,age\nAlice,30\nBob,25";
    const result = await md.convertBytes(new TextEncoder().encode(csv), {
      extension: ".csv",
      mimetype: "text/csv",
    });
    expect(result.markdown).toContain("| name | age |");
    expect(result.markdown).toContain("| Alice | 30 |");
  });
});

describe("HtmlConverter", () => {
  it("converts HTML to markdown", async () => {
    const md = new MarkItDown();
    const html = "<html><body><h1>Title</h1><p>Para</p></body></html>";
    const result = await md.convertBytes(new TextEncoder().encode(html), {
      extension: ".html",
      mimetype: "text/html",
    });
    expect(result.markdown.toLowerCase()).toContain("title");
    expect(result.markdown).toContain("Para");
  });
});

describe("IpynbConverter", () => {
  it("converts notebook cells", async () => {
    const md = new MarkItDown();
    const nb = {
     nbformat: 4,
     nbformat_minor: 5,
      cells: [
        { cell_type: "markdown", source: ["# Notebook\n"] },
        { cell_type: "code", source: ["print(1)\n"] },
      ],
    };
    const result = await md.convertBytes(new TextEncoder().encode(JSON.stringify(nb)), {
      extension: ".ipynb",
    });
    expect(result.markdown).toContain("# Notebook");
    expect(result.markdown).toContain("```python");
  });
});

describe("PKC", () => {
  it("round-trips pack/unpack", () => {
    const pkc = packToPkc("# Doc\n\nContent", { title: "Doc", source: "test.md" });
    const doc = unpackPkc(pkc);
    expect(doc.markdown).toBe("# Doc\n\nContent");
    expect(doc.title).toBe("Doc");
    expect(doc.version).toBe(1);
  });
});

describe("format detector", () => {
  it("guesses from stream", async () => {
    const { guessStreamFormats } = await import("../src/detect/format-detector.js");
    const stream = ByteStream.fromBuffer(new TextEncoder().encode('{"nbformat": 4}'));
    const guesses = await guessStreamFormats(stream, { extension: ".ipynb" });
    expect(guesses.length).toBeGreaterThan(0);
  });
});
