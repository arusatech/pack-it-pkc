import JSZip from "jszip";
import { load, type Element } from "cheerio";
import { oMathElementToLatex } from "./math/omml.js";

const PREPROCESS_FILES = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"];
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function localName(el: Element): string {
  return el.name.replace(/^[^:]+:/, "");
}

function preprocessMathXml(content: Uint8Array): Uint8Array {
  const xml = new TextDecoder("utf-8").decode(content);
  const $ = load(xml, { xml: true });
  const replacements: Array<{ from: string; to: string }> = [];

  $("*").each((_, el) => {
    const name = localName(el);
    if (name !== "oMath") return;

    const fragment = $.xml(el);
    const latex = oMathElementToLatex(fragment);
    const block = name === "oMathPara";
    const wrapped = block ? `$$${latex}$$` : `$${latex}$`;
    replacements.push({
      from: fragment,
      to: `<w:r xmlns:w="${W_NS}"><w:t>${wrapped}</w:t></w:r>`,
    });
  });

  let out = xml;
  for (const { from, to } of replacements.sort((a, b) => b.from.length - a.from.length)) {
    out = out.split(from).join(to);
  }

  // oMathPara wrappers become plain runs after child replacement
  out = out.replace(/<(?:m:)?oMathPara[^>]*>/g, "").replace(/<\/(?:m:)?oMathPara>/g, "");

  return new TextEncoder().encode(out);
}

/** Pre-process DOCX: convert OMML math elements to inline LaTeX before mammoth conversion. */
export async function preprocessDocx(bytes: Uint8Array): Promise<Uint8Array> {
  const input = await JSZip.loadAsync(bytes);
  const output = new JSZip();

  for (const [name, file] of Object.entries(input.files)) {
    if (file.dir) continue;
    let content = await file.async("uint8array");
    if (PREPROCESS_FILES.includes(name)) {
      content = preprocessMathXml(content);
    }
    output.file(name, content);
  }

  return new Uint8Array(await output.generateAsync({ type: "arraybuffer" }));
}
