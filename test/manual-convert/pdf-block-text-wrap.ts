/** Collapse line breaks to single spaces (annadata DocCanvasEditor wrap toggle). */
export function collapseNewlinesToSpaces(text: string): string {
  return text.replaceAll(/\s*\n+\s*/g, " ").trim();
}

/** Ionic `reorder-two-outline` — two horizontal lines. */
export const WRAP_TOGGLE_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="48" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M112 304h288M112 208h288"/></svg>`;
