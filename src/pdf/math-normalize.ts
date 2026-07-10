/**
 * mathNormalize — convert plain OCR / PDF math text to KaTeX LaTeX.
 */

const UNICODE_MATH_REPLACEMENTS: Array<[RegExp, string]> = [
  [/π/g, '\\pi'],
  [/α/g, '\\alpha'],
  [/β/g, '\\beta'],
  [/γ/g, '\\gamma'],
  [/δ/g, '\\delta'],
  [/ε/g, '\\epsilon'],
  [/θ/g, '\\theta'],
  [/λ/g, '\\lambda'],
  [/μ/g, '\\mu'],
  [/σ/g, '\\sigma'],
  [/φ/g, '\\phi'],
  [/ω/g, '\\omega'],
  [/Δ/g, '\\Delta'],
  [/Σ/g, '\\Sigma'],
  [/Ω/g, '\\Omega'],
  [/∞/g, '\\infty'],
  [/±/g, '\\pm'],
  [/×/g, '\\times'],
  [/÷/g, '\\div'],
  [/≤/g, '\\leq'],
  [/≥/g, '\\geq'],
  [/≠/g, '\\neq'],
  [/≈/g, '\\approx'],
  [/∫/g, '\\int'],
  [/∑/g, '\\sum'],
  [/√/g, '\\sqrt'],
  [/→/g, '\\rightarrow'],
  [/←/g, '\\leftarrow'],
  [/⇒/g, '\\Rightarrow'],
  [/∂/g, '\\partial'],
  [/·/g, '\\cdot'],
];

const MATH_INDICATORS =
  /(?:\\frac|\\sqrt|sqrt\s*\(|\\int|\\sum|\\lim|\\partial|\\pi|\\alpha|\\beta|\\theta|\\leq|\\geq|\\neq|\\infty|\^{|_\{|=\s*[a-zA-Z]|[a-zA-Z]\s*=\s*|[∫∑√π±≤≥≠≈∞]|\d+\s*\/\s*\d+)/;

const MATH_LINE =
  /^[\s0-9a-zA-Z+\-*/=^_{}().,\\∫∑√π±≤≥≠≈∞→←\s]+$/;

export function looksLikeMath(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^\$[\s\S]+\$$/.test(t) || /^\\\[[\s\S]+\\\]$/.test(t)) return true;
  if (t.length > 280 || t.split(/\s+/).length > 35) return false;
  if (/\\ce\{/.test(t)) return false;
  if (MATH_INDICATORS.test(t)) return true;
  if (MATH_LINE.test(t) && /[=^_\d]/.test(t) && /[a-zA-Z]/.test(t)) return true;
  return false;
}

export function mathNormalizeConfidence(plain: string, latex: string): number {
  const inner = unwrapMathDelimiters(latex);
  if (!inner) return 0.2;
  let score = 0.5;
  if (/\\frac|\\sqrt|\\int|\\sum/.test(inner)) score += 0.15;
  if (/\^{|_\{/.test(inner)) score += 0.15;
  if (!/[∫∑√π±≤≥≠≈∞]/.test(inner)) score += 0.1;
  if (plain.includes('^') && inner.includes('^{')) score += 0.1;
  return Math.min(1, score);
}

export function isLowConfidenceMathNormalization(plain: string, latex: string): boolean {
  return mathNormalizeConfidence(plain, latex) < 0.7;
}

export function unwrapMathDelimiters(tex: string): string {
  const t = tex.trim();
  if (t.startsWith('$$') && t.endsWith('$$')) return t.slice(2, -2).trim();
  if (t.startsWith('$') && t.endsWith('$')) return t.slice(1, -1).trim();
  if (t.startsWith('\\[') && t.endsWith('\\]')) return t.slice(2, -2).trim();
  if (t.startsWith('\\(') && t.endsWith('\\)')) return t.slice(2, -2).trim();
  return t;
}

export function wrapMathDelimiters(tex: string, display = false): string {
  const inner = unwrapMathDelimiters(tex);
  if (!inner) return tex;
  if (display || inner.length > 80 || inner.includes('\\\\')) {
    return `$$${inner}$$`;
  }
  return `$${inner}$`;
}

/** Convert OCR / PDF math plain text to KaTeX-ready LaTeX (with $ delimiters). */
export function plainMathToLatex(plain: string, display = false): string {
  let s = plain.trim();
  if (!s) return s;
  if (/^\$[\s\S]+\$$/.test(s) || /^\\\[[\s\S]+\\\]$/.test(s)) return s;

  for (const [re, rep] of UNICODE_MATH_REPLACEMENTS) {
    s = s.replace(re, rep);
  }

  s = s.replace(/sqrt\s*\(\s*([^)]+)\s*\)/gi, '\\sqrt{$1}');
  s = s.replace(/sqrt\s*([a-zA-Z0-9]+)/gi, '\\sqrt{$1}');

  s = s.replace(
    /(^|[^\w\\])([a-zA-Z])\s*(\d+)(?![a-zA-Z])/g,
    (_m, prefix: string, base: string, exp: string) => `${prefix}${base}^{${exp}}`,
  );

  s = s.replace(
    /([a-zA-Z])\s*_\s*(\d+)/g,
    (_m, base: string, sub: string) => `${base}_{${sub}}`,
  );

  s = s.replace(/(\d+)\s*\/\s*(\d+)/g, '\\frac{$1}{$2}');

  s = s.replace(
    /([a-zA-Z])\s*\/\s*([a-zA-Z0-9]+)/g,
    (match, num: string, den: string) => {
      if (!looksLikeMath(`${num}/${den}`)) return match;
      return `\\frac{${num}}{${den}}`;
    },
  );

  s = s.replace(/\s*\*\s*/g, ' \\times ');
  s = s.replace(/\s+/g, ' ').trim();

  return wrapMathDelimiters(s, display);
}

/** Extract $…$ or \\[…\\] from model output. */
export function extractLatexFromLlmResponse(raw: string): string | null {
  const trimmed = raw.trim();
  const display = /\$\$([\s\S]+?)\$\$/.exec(trimmed);
  if (display) return `$$${display[1]!.trim()}$$`;
  const inline = /\$([^$\n]+)\$/.exec(trimmed);
  if (inline) return `$${inline[1]!.trim()}$`;
  const bracket = /\\\[([\s\S]+?)\\\]/.exec(trimmed);
  if (bracket) return `$$${bracket[1]!.trim()}$$`;
  const fenced = /```(?:latex|tex)?\s*([\s\S]+?)```/i.exec(trimmed);
  if (fenced?.[1]?.trim()) {
    return plainMathToLatex(fenced[1].trim());
  }
  if (looksLikeMath(trimmed)) return plainMathToLatex(trimmed);
  return null;
}
