/**
 * chemistryNormalize — convert plain OCR / PDF text to mhchem \\ce{…} LaTeX.
 */

/** Always-replaced OCR / typography glitches. */
const UNCONDITIONAL_ARROW_REPLACEMENTS: Array<[RegExp, string]> = [
  [/®/g, '->'],
  [/©/g, '->'],
  [/→|⟶|⇒|⟹|➔|➜|➝|➞|➡/g, '->'],
  [/←|⟵|⇐/g, '<-'],
  [/↔|⟷|⇔/g, '<->'],
  // Unicode minus / en-dash / em-dash before >
  [/[−–—‐‑]\s*>/g, '->'],
  [/\s*-{2,}>\s*/g, ' -> '],
];

/** Chemistry-context-only arrow normalizations. */
const CHEM_ARROW_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\s*=\s*(?=[A-Z])/g, ' -> '],
];

export function normalizeArrowSymbols(text: string): string {
  let out = text;
  for (const [re, rep] of UNCONDITIONAL_ARROW_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  if (looksLikeChemistry(out)) {
    for (const [re, rep] of CHEM_ARROW_REPLACEMENTS) {
      out = out.replace(re, rep);
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Cu2+ → Cu^{2+}, Fe3+ → Fe^{3+}, Na+ → Na^{+}.
 * Also handles spaced / line-broken OCR: "Cu 2+" / "Cu\n2+".
 */
export function normalizeIonCharges(text: string): string {
  return text
    .replace(
      /([A-Z][a-z]?)\s*(\d+)\s*([+-])(?![0-9])/g,
      (_m, element: string, digits: string, sign: string) => `${element}^{${digits}${sign}}`,
    )
    .replace(
      /([A-Z][a-z]?)(\d+)([+-]+)(?![0-9A-Za-z{])/g,
      (_match, element: string, digits: string, charge: string) =>
        `${element}^{${digits}${charge}}`,
    )
    .replace(
      /([A-Z][a-z]?)([+-]+)(?![0-9A-Za-z{])/g,
      (_match, element: string, charge: string) => `${element}^{${charge}}`,
    );
}

const ELEMENT = '[A-Z][a-z]?';
const STATE = '\\((?:aq|s|l|g)\\)';
const CHEM_LINE =
  new RegExp(
    `${ELEMENT}(?:\\d*\\^{[^}]+}|\\d*[+-]+)?${STATE}?` +
      `(?:\\s*[+]\\s*${ELEMENT}(?:\\d*\\^{[^}]+}|\\d*[+-]+)?${STATE}?)*` +
      `\\s*(?:->|<->|<-)\\s*` +
      `${ELEMENT}`,
  );

const CHEM_STATE = /\((?:aq|s|l|g)\)/i;
const CHEM_INDICATORS =
  /(?:\d[+-]|[+-]\d|->|<->|®|→|⇒|\b(?:mol|aqueous|precipitate)\b)/i;

export function looksLikeChemistry(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Never trust a leading \ce{} alone — validate the inner content.
  if (t.startsWith("\\ce{") && t.endsWith("}")) {
    const inner = t.slice(4, -1);
    return isRealChemistryFormula(inner);
  }
  if (t.length > 120 || t.split(/\s+/).length > 12) return false;
  if (isMostlyProse(t)) return false;
  if (CHEM_LINE.test(t)) return true;
  if (CHEM_STATE.test(t) && /(?:->|<->|<-|\d[+-]|[+-]\d|\^{)/.test(t) && /[A-Z][a-z]?/.test(t)) {
    return true;
  }
  return false;
}

/** True when the string is mostly English prose, not a formula. */
export function isMostlyProse(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter((w) => /^[A-Za-z]{2,}$/.test(w.replace(/[^A-Za-z]/g, "")));
  const english = words.filter((w) => {
    const w2 = w.toLowerCase();
    return (
      w2.length >= 3 &&
      !/^(aq|mol|gas|solid|liquid|ion|ions|dm|vol|eq)$/.test(w2)
    );
  });
  if (english.length >= 5) return true;
  if (english.length >= 3 && t.length > 60) return true;
  // Common prose starters wrongly wrapped as chemistry
  if (/^(to|the|and|has|when|such|this|that|with|from|for|of)\b/i.test(t) && english.length >= 2) {
    return true;
  }
  return false;
}

/**
 * Strict check: short formula / reaction / ion — safe to put in \\ce{…}.
 */
export function isRealChemistryFormula(text: string): boolean {
  const t = text.trim();
  if (!t || isMostlyProse(t)) return false;
  if (t.length > 120) return false;
  if (t.split(/\s+/).length > 12) return false;

  // Reaction with arrow
  if (/(?:->|<->|<-)/.test(t) && /[A-Z][a-z]?/.test(t)) return true;
  // Ion / species: Zn^{2+}, Cu^{2+}(aq), H2O, Na+
  if (
    /^[A-Z][a-z]?(?:\d+)?(?:\^{[^}]+}|[0-9]*[+-]+)?(?:\((?:aq|s|l|g)\))?(?:\s*[+=]\s*[A-Z].*)?$/.test(
      t,
    )
  ) {
    return true;
  }
  // Salts / formulas / comma lists: ZnSO4, ZnSO_{4}, CuSO4 — user edits in text regions
  const formulaToken =
    "[A-Z][a-z]?(?:[A-Za-z0-9]|_\\{[^}]+\\}|\\^{[^}]+}|\\([^)]*\\))*";
  if (new RegExp(`^${formulaToken}(?:\\s*,\\s*${formulaToken})*$`).test(t.replace(/\s+/g, " "))) {
    return true;
  }
  // Compact multi-species without too many English words
  if (
    CHEM_STATE.test(t) &&
    /[A-Z][a-z]?/.test(t) &&
    /(?:\^{|->|\+|aq)/.test(t) &&
    !isMostlyProse(t)
  ) {
    return true;
  }
  return false;
}

/** Confidence 0–1 that rule-based output improved the plain OCR string. */
export function chemistryNormalizeConfidence(plain: string, mhchem: string): number {
  if (!mhchem.startsWith('\\ce{')) return 0.2;
  let score = 0.55;
  if (!/®|©|→|⟶|⇒/.test(mhchem)) score += 0.15;
  if (/\^{/.test(mhchem)) score += 0.15;
  if (/->|<->/.test(mhchem)) score += 0.1;
  if (plain.includes('®') && mhchem.includes('->')) score += 0.1;
  return Math.min(1, score);
}

export function isLowConfidenceNormalization(plain: string, mhchem: string): boolean {
  return chemistryNormalizeConfidence(plain, mhchem) < 0.72;
}

/** Convert one chemistry line to \\ce{…} (no $ delimiters).
 *  Never wraps English prose — use normalizeChemistryInText for mixed regions.
 */
export function plainChemistryToMhchem(plain: string): string {
  let s = plain.trim();
  if (!s) return s;

  if (s.startsWith("\\ce{") && s.endsWith("}")) {
    const inner = s.slice(4, -1);
    if (isRealChemistryFormula(inner)) return s;
    // Spurious whole-paragraph wrap — unwrap and only tag real chem spans.
    return normalizeChemistryInText(inner);
  }

  // Long prose / mistagged formula regions: keep sentences, wrap ions/reactions only.
  if (isMostlyProse(s) || !(isRealChemistryFormula(s) || looksLikeChemistry(s))) {
    return normalizeChemistryInText(s);
  }

  s = normalizeArrowSymbols(s);
  s = normalizeIonCharges(s);
  s = spaceReactionPlusOperators(s);
  return `\\ce{${s}}`;
}

/** Add spaces around + between species without breaking ^{2+} charge markers. */
function spaceReactionPlusOperators(s: string): string {
  return s
    .replace(/\)\s*\+\s*/g, ') + ')
    .replace(/\]\s*\+\s*/g, '] + ')
    .replace(/(\})\s*\+\s*/g, '$1 + ')
    .replace(/([A-Za-z0-9])\s*\+\s*(?=[A-Z(])/g, '$1 + ');
}

/**
 * Process multi-line text: chemistry lines → $\\ce{…}$; leave other lines as-is.
 * Also wraps inline chemistry spans on mixed lines.
 */
export function normalizeChemistryInText(text: string): string {
  if (!text.trim()) return text;

  return text
    .split('\n')
    .map((line) => normalizeChemistryLine(line))
    .join('\n');
}

function normalizeChemistryLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return line;
  if (trimmed.startsWith("$") && trimmed.endsWith("$")) return line;

  // Existing \ce{…} — keep only if it is a real formula; otherwise unwrap.
  if (trimmed.includes("\\ce{")) {
    return wrapInlineIonsAndReactions(stripSpuriousChemistryWraps(line));
  }

  // Prose with an embedded reaction → wrap only the reaction / ion spans.
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 6 || isMostlyProse(trimmed)) {
    return wrapInlineIonsAndReactions(line);
  }

  if (looksLikeChemistry(trimmed)) {
    const prefix = line.slice(0, line.indexOf(trimmed));
    const suffix = line.slice(line.indexOf(trimmed) + trimmed.length);
    return `${prefix}$${plainChemistryToMhchem(trimmed)}$${suffix}`;
  }

  return wrapInlineIonsAndReactions(line);
}

/** Wrap reactions and standalone ions; never swallow surrounding prose. */
function wrapInlineIonsAndReactions(line: string): string {
  // Work only outside existing $…$ spans (idempotent on already-polished text).
  return mapOutsideMath(line, (prose) => {
    let s = normalizeUnicodeMathPunctuation(prose);
    s = wrapInlineChemistrySpansInProse(s);
    s = s.replace(
      /\b([A-Z][a-z]?(?:\d+)?(?:\^{[^}]+})(?:\((?:aq|s|l|g)\))?)(?![A-Za-z0-9])/g,
      (match) => {
        if (!isRealChemistryFormula(match)) return match;
        return `$\\ce{${match}}$`;
      },
    );
    // Units like dm^{–3} / dm^{-3} → math (not mhchem)
    s = s.replace(
      /\b(mol\s+)?(dm|cm|mm|m|L|l)\s*\^{\s*([−–—‐‑-]?\d+)\s*\}/g,
      (_m, molPrefix: string | undefined, unit: string, exp: string) => {
        const e = exp.replace(/[−–—‐‑]/g, "-");
        const mol = molPrefix ? "\\mathrm{mol}\\," : "";
        return `$${mol}\\mathrm{${unit}}^{${e}}$`;
      },
    );
    return s;
  });
}

/** Normalize OCR punctuation that breaks LaTeX / mhchem. */
function normalizeUnicodeMathPunctuation(text: string): string {
  return text
    .replace(/[−–—‐‑]/g, "-")
    .replace(/×/g, "\\times ")
    .replace(/·/g, "\\cdot ");
}

/** Apply `fn` to prose segments only; leave $…$ / $$…$$ untouched. */
function mapOutsideMath(text: string, fn: (prose: string) => string): string {
  return text
    .split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g)
    .map((part) => {
      if (!part) return part;
      if (
        (part.startsWith("$$") && part.endsWith("$$")) ||
        (part.startsWith("$") && part.endsWith("$") && part.length >= 2)
      ) {
        return part;
      }
      // Also skip bare \\ce{…} / \\pu{…} already present in prose
      return mapOutsideCePu(part, fn);
    })
    .join("");
}

function mapOutsideCePu(text: string, fn: (prose: string) => string): string {
  if (!/\\(?:ce|pu)\{/.test(text)) return fn(text);
  let result = "";
  let i = 0;
  while (i < text.length) {
    const ce = text.indexOf("\\ce{", i);
    const pu = text.indexOf("\\pu{", i);
    let idx = -1;
    if (ce >= 0 && (pu < 0 || ce <= pu)) idx = ce;
    else if (pu >= 0) idx = pu;
    if (idx < 0) {
      result += fn(text.slice(i));
      break;
    }
    result += fn(text.slice(i, idx));
    const openBrace = idx + 4; // \ce{ or \pu{ — both length 4 to brace
    // Actually \ce{ is 4 chars, \pu{ is 4 chars. index of '{' is idx+3.
    const brace = idx + (text.startsWith("\\ce{", idx) ? "\\ce{".length : "\\pu{".length) - 1;
    let depth = 0;
    let j = brace;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      result += text.slice(idx);
      break;
    }
    result += text.slice(idx, j + 1);
    i = j + 1;
  }
  return result;
}

/** Find reaction-like spans in prose only (must include a reaction arrow). */
function wrapInlineChemistrySpansInProse(line: string): string {
  const species =
    "[A-Z][a-z]?(?:\\d*(?:\\^{[^}]+}|[+-]+))?(?:\\s*\\((?:aq|s|l|g)\\))?";
  const pattern = new RegExp(
    `(${species}(?:\\s*\\+\\s*${species})*\\s*(?:->|<->|<-|®|→|[−–—]>)\\s*${species}(?:\\s*\\+\\s*${species})*)`,
    "g",
  );

  return line.replace(pattern, (match) => {
    const withArrows = normalizeArrowSymbols(match);
    if (!/->|<->|<-/.test(withArrows)) return match;
    if (isMostlyProse(match)) return match;
    return `$${plainChemistryToMhchem(match)}$`;
  });
}

/**
 * Remove mistaken \\ce{…} wrappers around prose (and drop unclosed \\ce{).
 */
export function stripSpuriousChemistryWraps(text: string): string {
  if (!text.includes("\\ce{")) return text;

  // Normalize $\ce{…}$ and bare \ce{…} with brace matching.
  let result = "";
  let i = 0;
  while (i < text.length) {
    const dollarCe = text.indexOf("$\\ce{", i);
    const bareCe = text.indexOf("\\ce{", i);
    let idx = -1;
    let withDollars = false;
    if (dollarCe >= 0 && (bareCe < 0 || dollarCe <= bareCe)) {
      idx = dollarCe;
      withDollars = true;
    } else if (bareCe >= 0) {
      idx = bareCe;
      withDollars = false;
    }

    if (idx < 0) {
      result += text.slice(i);
      break;
    }

    result += text.slice(i, idx);
    const ceStart = withDollars ? idx + 1 : idx;
    const openBrace = ceStart + "\\ce{".length - 1;
    let depth = 0;
    let j = openBrace;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }

    if (depth !== 0) {
      // Unclosed — drop \ce{ (and leading $) and keep the rest as prose.
      result += text.slice(ceStart + "\\ce{".length);
      break;
    }

    const inner = text.slice(openBrace + 1, j);
    const trailingDollar = withDollars && text[j + 1] === "$";
    // Keep user-authored chemistry (ZnSO_{4}, ions, reactions). Only unwrap English prose.
    if (isMostlyProse(inner) && !isRealChemistryFormula(inner)) {
      result += inner;
      i = j + 1 + (trailingDollar ? 1 : 0);
    } else {
      const tidied = tidyCeInner(inner);
      result += `$\\ce{${tidied}}$`;
      i = j + 1 + (trailingDollar ? 1 : 0);
    }
  }

  return result.replace(/\$\s*\$/g, "").replace(/[ \t]{2,}/g, " ");
}

/** Normalize spacing inside a \\ce{…} body (user edits like "ZnSO_{4} ,CuSO_{4}"). */
function tidyCeInner(inner: string): string {
  return inner
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prepare any block text (text / heading / list / qa / formula) for Study PKC + render.
 * Preserves user \\ce{…} / \\pu{…}, wraps them in $…$, leaves surrounding prose alone.
 */
export function normalizeChemistryMarkupForStudy(text: string): string {
  if (!text?.trim()) return text ?? "";
  let s = text.replace(/\\ce\s*\{/g, "\\ce{").replace(/\\pu\s*\{/g, "\\pu{");
  if (!/\\ce\{|\\pu\{/.test(s)) return s;
  // Unwrap prose-only mistaken wraps, keep real formulas, ensure $ delimiters.
  s = stripSpuriousChemistryWraps(s);
  if (/\\ce\{|\\pu\{/.test(s)) {
    s = wrapMhchemBlocksInMathDelimiters(s);
  }
  return s;
}

/** True when editable content includes mhchem / math markup worth previewing. */
export function contentHasChemistryMarkup(text: string): boolean {
  return /\\ce\s*\{|\\pu\s*\{|\$\\ce\{|\$\\pu\{/.test(text ?? "");
}

/**
 * Wrap each \\ce{…} / \\pu{…} block in $…$ without wrapping surrounding prose.
 * Prevents KaTeX from treating cloze blanks (______) in prose as subscripts.
 */
export function wrapMhchemBlocksInMathDelimiters(text: string): string {
  if (!/\\ce\s*\{|\\pu\s*\{/.test(text)) return text;

  const normalized = text.replace(/\\ce\s*\{/g, '\\ce{').replace(/\\pu\s*\{/g, '\\pu{');
  if (/\$\\ce\{|\$\\pu\{/.test(normalized)) return normalized;

  const MACROS = ['\\ce{', '\\pu{'] as const;
  let result = '';
  let i = 0;

  while (i < normalized.length) {
    if (normalized[i] === '$') {
      const close = normalized.indexOf('$', i + 1);
      if (close > i) {
        result += normalized.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }

    let earliest = -1;
    let macroLen = 0;
    for (const m of MACROS) {
      const idx = normalized.indexOf(m, i);
      if (idx >= 0 && (earliest < 0 || idx < earliest)) {
        earliest = idx;
        macroLen = m.length;
      }
    }

    if (earliest < 0) {
      result += normalized.slice(i);
      break;
    }

    result += normalized.slice(i, earliest);
    const braceStart = earliest + macroLen - 1;
    let depth = 0;
    let j = braceStart;
    for (; j < normalized.length; j++) {
      const ch = normalized[j];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      // Unclosed \\ce{ / \\pu{ — drop the opener (same as chat sanitize), keep prose.
      result += normalized.slice(earliest + macroLen);
      break;
    }

    result += `$${normalized.slice(earliest, j + 1)}$`;
    i = j + 1;
  }

  return result;
}

/** Extract \\ce{…} from model output; returns null when missing. */
export function extractCeFromLlmResponse(raw: string): string | null {
  const trimmed = raw.trim();
  const ceMatch = /\\ce\{[\s\S]*?\}/.exec(trimmed);
  if (ceMatch) return ceMatch[0];
  const fenced = /```(?:latex|tex)?\s*(\S[\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]?.includes('\\ce{')) {
    const inner = /\\ce\{[\s\S]*?\}/.exec(fenced[1]);
    if (inner) return inner[0];
  }
  return null;
}
