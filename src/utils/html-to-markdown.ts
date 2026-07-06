import * as cheerio from "cheerio";
import TurndownService from "turndown";

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (!turndown) {
    turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    turndown.addRule("skipDataUris", {
      filter: (node) => node.nodeName === "IMG" && (node.getAttribute("src") ?? "").startsWith("data:"),
      replacement: () => "[image]",
    });
  }
  return turndown;
}

/** Convert an HTML string fragment to Markdown (used by DOCX/XLSX/PPTX converters). */
export function convertHtmlStringToMarkdown(htmlContent: string): string {
  const wrapped = htmlContent.includes("<html") ? htmlContent : `<html><body>${htmlContent}</body></html>`;
  const $ = cheerio.load(wrapped);
  $("script, style, noscript").remove();

  const bodyEl = $("body");
  const fragment = bodyEl.length > 0 ? cheerio.load(bodyEl.html() ?? "") : $;
  const inner = fragment.root().html() ?? fragment.root().text();

  try {
    return getTurndown().turndown(inner);
  } catch {
    return fragment.root().text();
  }
}
