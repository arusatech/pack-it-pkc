/**
 * Bundled plugin assets: KaTeX (formulas) + language fonts (future i18n).
 * Hosts can import files via `@annadata/pack-it-pkc/assets/...`.
 */

/** Relative paths under the package `assets/` folder (also mirrored in `dist/assets`). */
export const ASSET_ROOT = "assets" as const;

export const KATEX_ASSETS = {
  css: "assets/katex/katex.css",
  js: "assets/katex/katex.js",
  autoRender: "assets/katex/auto-render.js",
  mhchem: "assets/katex/mhchem.js",
  copyTex: "assets/katex/copy-tex.js",
  mathtexScriptType: "assets/katex/mathtex-script-type.js",
  renderA11yString: "assets/katex/render-a11y-string.js",
} as const;

/** Indic / regional UI fonts shipped for future multi-language support. */
export const LANGUAGE_FONT_IDS = [
  "ar",
  "as",
  "bn",
  "en",
  "gu",
  "hi",
  "kn",
  "ml",
  "mni",
  "mr",
  "ne",
  "ns",
  "or",
  "pa",
  "si",
  "ta",
  "te",
] as const;

export type LanguageFontId = (typeof LANGUAGE_FONT_IDS)[number];

export function languageFontPath(id: LanguageFontId): string {
  return `assets/fonts/${id}.ttf`;
}

/** KaTeX math fonts live alongside language fonts under assets/fonts/KaTeX_*. */
export function katexFontGlob(): string {
  return "assets/fonts/KaTeX_*";
}
