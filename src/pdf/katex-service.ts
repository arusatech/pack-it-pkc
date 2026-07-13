/**
 * KaTeX + mhchem rendering for formula / math blocks (ported from annadata-app KaTeXService).
 */

import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/contrib/mhchem";

import { wrapMhchemBlocksInMathDelimiters } from "./chemistry-normalize.js";

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
 * Do not use study-card prose wrapping here — it breaks \\ce{…} blocks.
 */
export function prepareContentForAutoRender(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return "";

  trimmed = trimmed.replace(/\\ce\s*\{/g, "\\ce{").replace(/\\pu\s*\{/g, "\\pu{");

  if (/\$[^$\n]+\$/.test(trimmed) && !/^\$[^$]+\$$/.test(trimmed)) {
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

  if ((/\^{|_\{/.test(trimmed) || /\\frac|\\sqrt/.test(trimmed)) && !/\$/.test(trimmed)) {
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

  el.innerHTML = renderToHtml(prepared, opts);
}
