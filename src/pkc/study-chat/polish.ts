/**
 * Polish study-chat replies for display: restore glued OCR spaces, fix chemistry,
 * strip passage prefixes, then clamp length.
 */

import {
  normalizeChemistryInText,
  normalizeIonCharges,
  stripSpuriousChemistryWraps,
} from "../../pdf/chemistry-normalize.js";

/**
 * Dictionary for ungluing OCR text (longest first).
 * Short words (to/of/is/…) are allowed only when the *entire* run
 * partitions cleanly — never mid-word leftovers like "c onstructi on".
 */
const SEGMENT_WORDS = [
  "respectively",
  "therefore",
  "according",
  "indicates",
  "passage",
  "sulfate",
  "sulphate",
  "aqueous",
  "solution",
  "copper",
  "react",
  "metal",
  "zinc",
  "salt",
  "form",
  "that",
  "this",
  "with",
  "from",
  "which",
  "when",
  "were",
  "been",
  "have",
  "into",
  "than",
  "then",
  "also",
  "and",
  "the",
  "for",
  "are",
  "was",
  "of",
  "to",
  "in",
  "is",
  "on",
  "as",
  "by",
  "or",
  "an",
  "at",
  "a",
].sort((a, b) => b.length - a.length);

/**
 * Segment only when the whole run is a concatenation of dictionary words.
 * Returns null if coverage fails → leave the original word untouched.
 */
function tryFullSegment(run: string): string[] | null {
  if (run.length < 12) return null;
  const lower = run.toLowerCase();

  function dfs(i: number): string[] | null {
    if (i === lower.length) return [];
    for (const w of SEGMENT_WORDS) {
      if (i + w.length > lower.length) continue;
      if (!lower.startsWith(w, i)) continue;
      // Don't start a long glued run with a 1–2 letter word alone.
      if (w.length <= 2 && i === 0) continue;
      const rest = dfs(i + w.length);
      if (rest) return [run.slice(i, i + w.length), ...rest];
    }
    return null;
  }

  const parts = dfs(0);
  if (!parts || parts.length < 2) return null;
  return parts;
}

function segmentGluedRun(run: string): string {
  const parts = tryFullSegment(run);
  return parts ? parts.join(" ") : run;
}

/** True when the reply looks like space-stripped OCR (not normal English). */
function looksHeavilyGlued(text: string): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const long = tokens.filter((t) => /^[A-Za-z]{16,}$/.test(t));
  if (long.length > 0) return true;
  const avg = tokens.reduce((n, t) => n + t.length, 0) / tokens.length;
  return avg >= 14 && tokens.length <= 6;
}

/** Insert spaces missing from OCR / LLM copies of PDF text. */
export function restoreMissingSpaces(text: string): string {
  let s = text;
  s = s.replace(/([.,:;!?])([A-Za-z])/g, "$1 $2");
  s = s.replace(/([a-z])(\[)/gi, "$1 $2");
  s = s.replace(/(\])([A-Za-z])/g, "$1 $2");
  s = s.replace(/(\))([A-Za-z])/g, "$1 $2");
  // isZn(s) / ofCu2+
  s = s.replace(/([a-z])([A-Z][a-z]?(?:\d|\(|\^))/g, "$1 $2");

  // Only dictionary-segment long alpha runs when the reply looks glued overall,
  // or the individual run is long enough that full coverage is meaningful.
  const aggressive = looksHeavilyGlued(s);
  s = s.replace(/[A-Za-z]{12,}/g, (run) => {
    if (/[A-Z].*[A-Z]/.test(run)) return run; // chem-like cluster
    if (!aggressive && run.length < 18) return run;
    return segmentGluedRun(run);
  });
  return s.replace(/[ \t]+/g, " ").trim();
}

/** Join line-broken ion charges before whitespace collapse: "Cu\\n2+\\n(aq)". */
export function joinBrokenIonCharges(text: string): string {
  return text
    .replace(/([A-Z][a-z]?)\s*[\r\n]+\s*(\d+)\s*[\r\n]*\s*([+-])/g, "$1$2$3")
    .replace(/([A-Z][a-z]?)\s+(\d+)\s*([+-])(?!\d)/g, "$1$2$3");
}

export function stripPassagePrefix(text: string): string {
  let s = text
    .replace(
      /^(?:according\s+to\s+)?passage\s*\[\d+\]\s*[,:.\-–—]?\s*/i,
      "",
    )
    .replace(/\baccording\s+to\s+passage\s*\[\d+\]\s*[,:.\-–—]?\s*/gi, "")
    .trim();
  if (s && /^[a-z]/.test(s)) {
    s = s[0]!.toUpperCase() + s.slice(1);
  }
  return s;
}

/**
 * Make a study-chat reply readable: same formula cleanup as Blocks → formula,
 * plus strip bad \\ce{prose}, units → \\pu{…}, footnotes.
 */
export function polishStudyChatReply(text: string): string {
  if (!text.trim()) return text;

  let s = joinBrokenIonCharges(text);
  s = s.replace(/\s+/g, " ").trim();
  // Unwrap bad \\ce{prose…} / unclosed \\ce{ before anything else.
  s = stripSpuriousChemistryWraps(s);
  s = stripReproduceFormulaFluff(s);
  s = restoreMissingSpaces(s);
  s = stripPassagePrefix(s);
  s = normalizeSuperscriptsAndFootnotes(s);
  s = normalizeIonCharges(s);
  // Tighten "Cu^{2+} (aq)" → "Cu^{2+}(aq)" so mhchem wrappers match.
  s = s.replace(/(\^{[^}]+})\s+\((aq|s|l|g)\)/gi, "$1($2)");
  s = s.replace(/([A-Z][a-z]?(?:\d+)?)\s+\((aq|s|l|g)\)/g, "$1($2)");
  s = wrapConcentrationUnits(s);
  s = normalizeChemistryInText(s);
  s = stripSpuriousChemistryWraps(s);
  s = dedupeAdjacentChemistryBlocks(s);
  s = s.replace(/\s+/g, " ").trim();
  // Never leave a truncated \\ce{Zn(s) + for KaTeX to choke on.
  return dropIncompleteMathLocal(s);
}

/**
 * Collapse back-to-back identical \\ce{…} (with or without $ wrappers).
 * Fixes extractive/OCR doubles like: $\\ce{Zn…}$$\\ce{Zn…}$ or \\ce{A}\\ce{A}.
 */
export function dedupeAdjacentChemistryBlocks(text: string): string {
  if (!/\\ce\{/.test(text)) return text;

  let s = text;
  // Same inner formula repeated 2+ times, optional $ around each.
  const repeated =
    /(\$?)\\ce\{((?:[^{}]|\{[^}]*\})*)\}(\$?)(?:\s*(?:\$?\\ce\{\2\}\$?))+/g;

  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(repeated, (_m, openDollar: string, inner: string, closeDollar: string) => {
      const wrap = openDollar === "$" || closeDollar === "$";
      return wrap ? `$\\ce{${inner}}$` : `\\ce{${inner}}`;
    });
  }
  return s;
}

function dropIncompleteMathLocal(text: string): string {
  let s = text.trim();
  if (!s) return s;
  if (((s.match(/\$/g) || []).length & 1) === 1) {
    s = s.slice(0, s.lastIndexOf("$")).trimEnd();
  }
  s = s.replace(/\$?\\(?:ce|pu)\{(?:[^{}]|\{[^}]*\})*$/g, "").trimEnd();
  s = s.replace(/\$\\(?:ce|pu)\{[^$]*$/g, "").trimEnd();
  s = s.replace(/\s*(?:\+|<-|->|<->)\s*$/g, "").trimEnd();
  return s.replace(/[ \t]+/g, " ").trim();
}

/** Drop LLM/OCR "Reproduce this formula:" when the body is prose. */
function stripReproduceFormulaFluff(text: string): string {
  return text.replace(/^reproduce\s+this\s+formula:\s*/i, "").trim();
}

/** Unicode minus in superscripts + drop footnote markers like ^{*}. */
function normalizeSuperscriptsAndFootnotes(text: string): string {
  let s = text;
  // Normalize dashes inside ^{…}
  s = s.replace(/\^{([^}]*)}/g, (_m, inner: string) => {
    const cleaned = String(inner).replace(/[−–—‐‑]/g, "-").trim();
    return `^{${cleaned}}`;
  });
  // Footnote / reference junk: )^{*}  )^*  ^{*}  *
  s = s.replace(/\)\s*\^\{\s*\*\s*\}/g, ")");
  s = s.replace(/\)\s*\^\s*\*/g, ")");
  s = s.replace(/\^\{\s*\*\s*\}/g, "");
  s = s.replace(/\^\*/g, "");
  return s;
}

/**
 * Typeset concentration / SI-ish units the way Blocks formulas do — via \\pu{…}.
 * e.g. "1 mol dm^{-3}" → "$\\pu{1 mol dm^{-3}}$"
 */
function wrapConcentrationUnits(text: string): string {
  return text
    .split(/(\$[^$]+\$)/g)
    .map((part) => {
      if (part.startsWith("$") && part.endsWith("$")) return part;
      return part.replace(
        /\b(\d+(?:\.\d+)?\s+)?mol\s*dm\^\{-?\d+\}/gi,
        (match) => {
          const unit = match.replace(/\s+/g, " ").trim();
          return `$\\pu{${unit}}$`;
        },
      );
    })
    .join("");
}

