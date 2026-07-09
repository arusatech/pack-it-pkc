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

describe("PdfConverter", () => {
  it("extracts text from a minimal PDF via MuPDF", async () => {
    const pdf = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 72 200 Td (Hello PDF) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000270 00000 n 
0000000369 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
428
%%EOF`;
    const md = new MarkItDown();
    const result = await md.convertBytes(new TextEncoder().encode(pdf), {
      extension: ".pdf",
      mimetype: "application/pdf",
    });
    expect(result.markdown).toMatch(/Hello\s*PDF/i);
  });

  it("returns editable block model for PDFs", async () => {
    const { extractPdfBlocks, blocksToMarkdown } = await import("../src/convert/pdf/index.js");
    const pdf = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 72 200 Td (Hello PDF) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000270 00000 n 
0000000369 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
428
%%EOF`;
    const doc = await extractPdfBlocks(new TextEncoder().encode(pdf), { sort: true });
    expect(doc.version).toBe(1);
    expect(doc.pageCount).toBe(1);
    const page = doc.pages["0"];
    expect(page?.order.length).toBeGreaterThan(0);
    const firstId = page!.order[0]!;
    const block = page!.blocks[firstId];
    expect(block?.type).toMatch(/text|heading/);
    expect(block?.content).toMatch(/Hello/i);

    const edited = {
      ...doc,
      pages: {
        ...doc.pages,
        "0": {
          ...page!,
          blocks: {
            ...page!.blocks,
            [firstId]: { ...block!, content: "Edited hello" },
          },
        },
      },
    };
    expect(blocksToMarkdown(edited)).toContain("Edited hello");
  });
});

describe("Phase 3 converters", () => {
  it("merges MasterFormat partial numbering", async () => {
    const { mergePartialNumberingLines } = await import("../src/convert/pdf/merge-partial-numbering.js");
    const input = ".1\nThe intent of this section.\n\n.2\nSecond item.";
    const out = mergePartialNumberingLines(input);
    expect(out).toContain(".1 The intent");
    expect(out).toContain(".2 Second item");
  });

  it("converts RSS feed", async () => {
    const md = new MarkItDown();
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><item><title>Post</title><description>Hello</description></item></channel></rss>`;
    const result = await md.convertBytes(new TextEncoder().encode(rss), { extension: ".rss" });
    expect(result.markdown).toContain("# Feed");
    expect(result.markdown).toContain("Post");
  });

  it("converts Wikipedia HTML when URL matches", async () => {
    const md = new MarkItDown();
    const html = `<html><body><h1 class="mw-page-title-main">Earth</h1><div id="mw-content-text"><p>Third planet.</p></div></body></html>`;
    const result = await md.convertBytes(new TextEncoder().encode(html), {
      extension: ".html",
      mimetype: "text/html",
      url: "https://en.wikipedia.org/wiki/Earth",
    });
    expect(result.markdown).toContain("Earth");
    expect(result.markdown).toContain("Third planet");
  });

  it("converts Bing SERP HTML when URL matches", async () => {
    const targetUrl = "https://example.com/docs";
    const encodedU = "a1" + Buffer.from(targetUrl).toString("base64url");
    const redirectHref = `https://www.bing.com/ck/a?u=${encodeURIComponent(encodedU)}`;
    const html = `<html><head><title>docs - Search</title></head><body>
<div class="b_algo">
  <h2><a href="${redirectHref}">Example Docs</a></h2>
  <p class="tptt">Official documentation</p>
  <span class="algoSlug_icon"></span>
</div>
<div class="b_algo">
  <h2><a href="https://other.example/page">Other Result</a></h2>
  <p>Plain link result</p>
</div>
</body></html>`;
    const md = new MarkItDown();
    const result = await md.convertBytes(new TextEncoder().encode(html), {
      extension: ".html",
      mimetype: "text/html",
      url: "https://www.bing.com/search?q=docs",
    });
    expect(result.markdown).toContain("## A Bing search for 'docs' found the following results:");
    expect(result.markdown).toContain("Example Docs");
    expect(result.markdown).toContain(targetUrl);
    expect(result.markdown).toContain("Official documentation");
    expect(result.markdown).toContain("Other Result");
    expect(result.markdown).toContain("https://other.example/page");
    expect(result.title).toBe("docs - Search");
  });

  it("converts OMML math to latex", async () => {
    const { oMathElementToLatex } = await import("../src/convert/docx/math/omml.js");
    const latex = oMathElementToLatex("<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>");
    expect(latex).toBe("x");
  });

  it("preprocesses DOCX OMML to LaTeX markers", async () => {
    const { preprocessDocx } = await import("../src/convert/docx/pre-process.js");
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:body></w:document>`,
    );
    const bytes = new Uint8Array(await zip.generateAsync({ type: "arraybuffer" }));
    const processed = await preprocessDocx(bytes);
    const entry = await JSZip.loadAsync(processed);
    const docXml = await entry.file("word/document.xml")?.async("string");
    expect(docXml).toMatch(/\$.*x.*\$/);
  });
});

describe("Office converters (phase 2)", () => {
  it("converts XLSX to markdown tables", async () => {
    const { createMinimalXlsx } = await import("./office-fixtures.js");
    const md = new MarkItDown();
    const result = await md.convertBytes(createMinimalXlsx(), {
      extension: ".xlsx",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(result.markdown).toContain("## Results");
    expect(result.markdown).toContain("Alice");
  });

  it("converts DOCX via mammoth", async () => {
    const { createMinimalDocx } = await import("./office-fixtures.js");
    const md = new MarkItDown();
    const bytes = await createMinimalDocx("Quarterly Report");
    const result = await md.convertBytes(bytes, { extension: ".docx" });
    expect(result.markdown).toContain("Quarterly Report");
  });

  it("converts PPTX slides to markdown", async () => {
    const { createMinimalPptx } = await import("./office-fixtures.js");
    const md = new MarkItDown();
    const bytes = await createMinimalPptx("Q1 Review", "Revenue up 10%");
    const result = await md.convertBytes(bytes, { extension: ".pptx" });
    expect(result.markdown).toContain("Q1 Review");
    expect(result.markdown).toContain("Revenue up 10%");
    expect(result.markdown).toContain("Slide number: 1");
  });

  it("extracts PPTX slide images via _rels path", async () => {
    const { createMinimalPptxWithImage } = await import("./office-fixtures.js");
    const md = new MarkItDown();
    const bytes = await createMinimalPptxWithImage();
    const result = await md.convertBytes(bytes, { extension: ".pptx" });
    expect(result.markdown).toContain("![chart.png](chart.png)");
  });
});
