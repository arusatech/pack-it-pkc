import JSZip from "jszip";
import { load } from "cheerio";
import { oMathElementToLatex } from "./math/omml.js";

const PREPROCESS_FILES = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"];
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function localName(el: { type?: string; name?: string }): string | null {
  if (el.type !== "tag" || !el.name) return null;
  return el.name.replace(/^[^:]+:/, "");
}

function preprocessMathXml(content: Uint8Array): Uint8Array {
  const xml = new TextDecoder("utf-8").decode(content);
  const $ = load(xml, { xml: true });
  const replacements: Array<{ from: string; to: string }> = [];

  // Block equations: oMathPara → paragraph with $$…$$ per child oMath (Python order: para first)
  $("*").each((_, el) => {
    const name = localName(el);
    if (name !== "oMathPara") return;

    const $el = $(el);
    const parts: string[] = [];
    $el.find("*").each((__, child) => {
      if (localName(child) !== "oMath") return;
      const latex = oMathElementToLatex($.xml(child));
      if (latex) parts.push(`$$${latex}$$`);
    });

    if (!parts.length) return;
    replacements.push({
      from: $.xml(el),
      to: `<w:p xmlns:w="${W_NS}"><w:r><w:t>${parts.join("\n")}</w:t></w:r></w:p>`,
    });
  });

  // Inline equations: remaining oMath elements
  $("*").each((_, el) => {
    const name = localName(el);
    if (name !== "oMath") return;

    const fragment = $.xml(el);
    const latex = oMathElementToLatex(fragment);
    replacements.push({
      from: fragment,
      to: `<w:r xmlns:w="${W_NS}"><w:t>$${latex}$</w:t></w:r>`,
    });
  });

  let out = xml;
  for (const { from, to } of replacements.sort((a, b) => b.from.length - a.from.length)) {
    out = out.split(from).join(to);
  }

  return new TextEncoder().encode(out);
}

/** Pre-process DOCX: convert OMML math elements to inline LaTeX before mammoth conversion. */
export async function preprocessDocx(bytes: Uint8Array): Promise<Uint8Array> {
  const input = await JSZip.loadAsync(bytes);
  const output = new JSZip();

  for (const [name, file] of Object.entries(input.files)) {
    if (file.dir) continue;
    let content: Uint8Array = await file.async("uint8array");
    if (PREPROCESS_FILES.includes(name)) {
      content = preprocessMathXml(content);
    }
    output.file(name, content);
  }

  return new Uint8Array(await output.generateAsync({ type: "arraybuffer" }));
}
