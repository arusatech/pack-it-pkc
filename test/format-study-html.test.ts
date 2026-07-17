import { describe, expect, it } from "vitest";
import { formatStudyHtml } from "../src/pkc/study-chat/format-html.js";

describe("formatStudyHtml", () => {
  it("escapes HTML in plain text", () => {
    const html = formatStudyHtml("a <b> & c");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp;");
    expect(html).not.toContain("<b>");
  });

  it("renders inline math delimiters", () => {
    const html = formatStudyHtml("Energy $E=mc^2$ units");
    expect(html).toContain("katex");
    expect(html).toContain("Energy");
    expect(html).toContain("units");
  });
});
