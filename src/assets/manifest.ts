/**
 * Bundled plugin assets: KaTeX (formulas) + language fonts (future i18n).
 *
 * Static files live at repo-root `assets/` (ASSET_ROOT) and are copied to
 * `dist/assets/` on build. Paths below are package import specifiers that
 * resolve via package.json `exports` (`"./assets/*" → "./dist/assets/*"`).
 */

export const PACKAGE_NAME = "@annadata/pack-it-pkc" as const;

/** Package-scoped root for static assets (`@annadata/pack-it-pkc/assets`). */
export const ASSET_ROOT = `${PACKAGE_NAME}/assets` as const;

function assetPath(relative: string): `${typeof PACKAGE_NAME}/assets/${string}` {
  return `${PACKAGE_NAME}/assets/${relative}`;
}

export const KATEX_ASSETS = {
  css: assetPath("katex/katex.css"),
  js: assetPath("katex/katex.js"),
  autoRender: assetPath("katex/auto-render.js"),
  mhchem: assetPath("katex/mhchem.js"),
  copyTex: assetPath("katex/copy-tex.js"),
  mathtexScriptType: assetPath("katex/mathtex-script-type.js"),
  renderA11yString: assetPath("katex/render-a11y-string.js"),
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

/** Package import path for a language font, e.g. `@annadata/pack-it-pkc/assets/fonts/hi.ttf`. */
export function languageFontPath(id: LanguageFontId): string {
  return assetPath(`fonts/${id}.ttf`);
}

/** Package import path for language `@font-face` CSS. */
export const LANGUAGE_FONTS_CSS = assetPath("fonts/languages.css");

/**
 * Glob-style hint for KaTeX math fonts under the package assets tree.
 * Prefer concrete URLs from your bundler; this is not a filesystem glob.
 */
export function katexFontGlob(): string {
  return `${ASSET_ROOT}/fonts/KaTeX_*`;
}
