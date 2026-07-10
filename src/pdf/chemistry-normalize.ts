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
 * Cu2+ → Cu^{2+}, Fe3+ → Fe^{3+}, Na+ → Na^{+}, SO4 2- handled partially.
 */
export function normalizeIonCharges(text: string): string {
  return text.replace(
    /([A-Z][a-z]?)(\d*)\s*([+-]+)/g,
    (_match, element: string, digits: string, charge: string) => {
      const sup = digits ? `${digits}${charge}` : charge;
      return `${element}^{${sup}}`;
    },
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
  if (t.startsWith('\\ce{')) return true;
  if (t.length > 160 || t.split(/\s+/).length > 20) return false;
  if (CHEM_LINE.test(t)) return true;
  if (CHEM_STATE.test(t) && CHEM_INDICATORS.test(t) && /[A-Z][a-z]?/.test(t)) return true;
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

/** Convert one chemistry line to \\ce{…} (no $ delimiters). */
export function plainChemistryToMhchem(plain: string): string {
  let s = plain.trim();
  if (!s) return s;
  if (s.startsWith('\\ce{') && s.endsWith('}')) return s;

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
  if (trimmed.startsWith('$') && trimmed.endsWith('$')) return line;
  if (trimmed.startsWith('\\ce{')) return `$${trimmed}$`;

  if (looksLikeChemistry(trimmed)) {
    const prefix = line.slice(0, line.indexOf(trimmed));
    const suffix = line.slice(line.indexOf(trimmed) + trimmed.length);
    return `${prefix}$${plainChemistryToMhchem(trimmed)}$${suffix}`;
  }

  return wrapInlineChemistrySpans(line);
}

/** Find reaction-like spans inside a longer sentence (must include a reaction arrow). */
function wrapInlineChemistrySpans(line: string): string {
  const pattern =
    /([A-Z][a-z]?(?:\d*[+-]+|\((?:aq|s|l|g)\))?(?:\s*\+\s*[A-Z][a-z]?(?:\d*[+-]+|\((?:aq|s|l|g)\))?)+(?:\s*(?:->|®|→)\s*[A-Z][a-z]?(?:\d*[+-]+|\((?:aq|s|l|g)\))?(?:\s*\+\s*[A-Z][a-z]?(?:\d*[+-]+|\((?:aq|s|l|g)\))?)*)+)/g;

  return line.replace(pattern, (match) => {
    if (!looksLikeChemistry(match)) return match;
    return `$${plainChemistryToMhchem(match)}$`;
  });
}

/**
 * Remove mistaken $\\ce{…}$ wrappers from prose (e.g. Fig. 2.2(a) false positives).
 * Used when displaying text segments.
 */
export function stripSpuriousChemistryWraps(text: string): string {
  if (!text.includes('\\ce{')) return text;
  return text.replace(/\$\\ce\{([^}]*)\}\$/g, (match, inner: string) => {
    if (looksLikeChemistry(inner)) return match;
    return inner;
  });
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
      result += normalized.slice(earliest);
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
