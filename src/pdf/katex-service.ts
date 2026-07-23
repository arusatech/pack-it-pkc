/**
 * KaTeX + mhchem rendering for formula / math blocks (ported from annadata-app KaTeXService).
 */

import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/contrib/mhchem";

import { wrapMhchemBlocksInMathDelimiters, stripSpuriousChemistryWraps, normalizeChemistryInText } from "./chemistry-normalize.js";

export interface RenderMathOptions {
  displayMode?: boolean;
  throwOnError?: boolean;
}

const AUTO_RENDER_DELIMITERS = [
  { left: "$$", right: "$$", display: true },
  { left: "$", right: "$", display: false },
  { left: "\\(", right: "\\)", display: false },
  { left: "\\[", right: "\\]", display: true },
] as const;

const KATEX_OPTS = {
  throwOnError: false,
  errorColor: "#cc0000",
  macros: {
    "\\RR": "\\mathbb{R}",
    "\\NN": "\\mathbb{N}",
    "\\ZZ": "\\mathbb{Z}",
    "\\QQ": "\\mathbb{Q}",
    "\\CC": "\\mathbb{C}",
  },
};

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Render a LaTeX / mhchem string to HTML. */
export function renderToHtml(tex: string, opts: RenderMathOptions = {}): string {
  const trimmed = tex.trim();
  if (!trimmed) return "";
  try {
    return katex.renderToString(trimmed, {
      ...KATEX_OPTS,
      displayMode: opts.displayMode ?? false,
      throwOnError: opts.throwOnError ?? false,
    });
  } catch {
    return escapeHtml(trimmed);
  }
}

/** Scan an element for $…$, \\ce{}, etc. and typeset in place. */
export function renderMathInDom(element: HTMLElement): void {
  if (!element) return;
  try {
    renderMathInElement(element, {
      delimiters: [...AUTO_RENDER_DELIMITERS],
      ...KATEX_OPTS,
    });
  } catch {
    /* non-fatal */
  }
}

/** True when content likely contains math or mhchem markup. */
export function containsMathOrChemistry(text: string): boolean {
  if (!text?.trim()) return false;
  return (
    /\$\$[\s\S]+?\$\$/.test(text) ||
    /\$[^$\n]+\$/.test(text) ||
    /\\\([\s\S]+?\\\)/.test(text) ||
    /\\\[[\s\S]+?\\\]/.test(text) ||
    /\\ce\s*\{/.test(text) ||
    /\\pu\s*\{/.test(text)
  );
}

/**
 * Prepare formula / math for KaTeX auto-render.
 * Shared by Blocks formula preview and study/chat rendering.
 */
export function prepareContentForAutoRender(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return "";

  trimmed = trimmed.replace(/\\ce\s*\{/g, "\\ce{").replace(/\\pu\s*\{/g, "\\pu{");
  // Drop prose wrongly wrapped in \\ce{…} (and unclosed \\ce{).
  trimmed = stripSpuriousChemistryWraps(trimmed);
  // After unwrap, promote bare ions / units in remaining prose for preview.
  if (!/^\\ce\{/.test(trimmed.trim()) && /(?:\^{|[A-Z][a-z]?\d*[+-])/.test(trimmed)) {
    trimmed = normalizeChemistryInText(trimmed);
  }

  if (/\$[^$\n]+\$/.test(trimmed) && !/^\$[^$]+\$$/.test(trimmed)) {
    // Mixed prose + already-delimited math — only ensure \\ce/\\pu are $-wrapped.
    if (/\\ce\{|\\pu\{/.test(trimmed)) {
      return wrapMhchemBlocksInMathDelimiters(trimmed);
    }
    return trimmed;
  }

  if (/^\\ce\{[\s\S]*\}$/.test(trimmed) && !/\$/.test(trimmed)) {
    return `$${trimmed}$`;
  }

  if (/^\\pu\{[\s\S]*\}$/.test(trimmed) && !/\$/.test(trimmed)) {
    return `$${trimmed}$`;
  }

  if (/^\$[\s\S]+\$$/.test(trimmed) || /^\\\(|^\\\[/.test(trimmed)) {
    return trimmed;
  }

  if (/\\ce\{|\\pu\{/.test(trimmed)) {
    return wrapMhchemBlocksInMathDelimiters(trimmed);
  }

  // Whole-string math only for short formula-like content (not prose with a ^{…}).
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (
    wordCount <= 8 &&
    trimmed.length <= 80 &&
    (/\^{|_\{|\\frac|\\sqrt/.test(trimmed)) &&
    !/\b(the|and|when|such|called|equal|concentration|electrical|device)\b/i.test(trimmed) &&
    !/\$/.test(trimmed)
  ) {
    return `$${trimmed}$`;
  }

  return trimmed;
}

/** Render prepared content into a preview element (static HTML or auto-render). */
export function mountFormulaPreview(
  el: HTMLElement,
  content: string,
  opts: RenderMathOptions = {},
): void {
  const prepared = prepareContentForAutoRender(content);
  if (!prepared) {
    el.innerHTML = "";
    return;
  }

  // Mixed / delimited math — auto-render in place.
  if (containsMathOrChemistry(prepared) && /\$/.test(prepared)) {
    el.textContent = prepared;
    renderMathInDom(el);
    // If auto-render left the raw source (no .katex nodes), fall back to direct render.
    if (!el.querySelector(".katex")) {
      el.innerHTML = renderToHtml(
        prepared.replace(/^\$\$([\s\S]*)\$\$$/, "$1").replace(/^\$([\s\S]*)\$$/, "$1"),
        opts,
      );
    }
    return;
  }

  // Whole-string \\ce{…} / \\pu{…} (prepare may leave these without $).
  const bare = prepared.trim();
  if (/^\\(?:ce|pu)\{[\s\S]*\}$/.test(bare)) {
    el.innerHTML = renderToHtml(bare, opts);
    return;
  }

  // Prose / OCR mistagged as formula — show as text. Never feed to KaTeX
  // (math mode collapses spaces between words into jammed identifiers).
  el.innerHTML = escapeHtml(prepared).replace(/\n/g, "<br />");
}
