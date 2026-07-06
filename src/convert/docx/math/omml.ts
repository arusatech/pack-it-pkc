import { load, type Cheerio, type CheerioAPI, type Element } from "cheerio";
import {
  ALN,
  ARR,
  BACKSLASH,
  BLANK,
  BRK,
  CHARS,
  CHR,
  CHR_BO,
  CHR_DEFAULT,
  D,
  D_DEFAULT,
  F,
  F_DEFAULT,
  FUNC,
  FUNC_PLACE,
  LIM_FUNC,
  LIM_TO,
  LIM_UPP,
  M,
  POS,
  POS_DEFAULT,
  RAD,
  RAD_DEFAULT,
  SUB,
  SUP,
  T,
} from "./latex-dict.js";

function escapeLatex(str: string): string {
  let last: string | null = null;
  let out = "";
  const normalized = str.replace(/\\\\/g, "\\");
  for (const c of normalized) {
    if (CHARS.includes(c) && last !== BACKSLASH) out += BACKSLASH + c;
    else out += c;
    last = c;
  }
  return out;
}

function getVal(key: string | undefined, fallback: string | undefined, store?: Record<string, string>): string {
  if (key !== undefined) return store?.[key] ?? key;
  return fallback ?? "";
}

function localName(el: Element): string {
  return el.name.replace(/^[^:]+:/, "");
}

function childElements($: CheerioAPI, el: Cheerio<Element>): Element[] {
  return el
    .children()
    .toArray()
    .filter((node): node is Element => node.type === "tag");
}

class Pr {
  text = "";

  constructor($: CheerioAPI, el: Cheerio<Element>) {
    this.text = processChildren($, el);
  }

  get chr() {
    return this.attr("chr");
  }
  get pos() {
    return this.attr("pos");
  }
  get begChr() {
    return this.attr("begChr");
  }
  get endChr() {
    return this.attr("endChr");
  }
  get type() {
    return this.attr("type");
  }

  private attrs: Record<string, string> = {};

  private attr(name: string): string | undefined {
    return this.attrs[name];
  }

  static from($: CheerioAPI, el: Cheerio<Element>): Pr {
    const pr = new Pr($, el);
    el.children().each((_, child) => {
      const tag = localName(child);
      if (["chr", "pos", "begChr", "endChr", "type"].includes(tag)) {
        pr.attrs[tag] = $(child).attr("m:val") ?? $(child).attr("val") ?? "";
      }
    });
    return pr;
  }
}

function childDict($: CheerioAPI, el: Cheerio<Element>, include?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const child of childElements($, el)) {
    const tag = localName(child);
    if (include && !include.includes(tag)) continue;
    out[tag] = new OMath2Latex($, $(child)).latex;
  }
  return out;
}

function processChildren($: CheerioAPI, el: Cheerio<Element>, include?: string[]): string {
  const parts: string[] = [];
  for (const child of childElements($, el)) {
    const tag = localName(child);
    if (include && !include.includes(tag)) continue;
    if (tag.endsWith("Pr")) {
      parts.push(Pr.from($, $(child)).text);
      continue;
    }
    parts.push(new OMath2Latex($, $(child)).latex);
  }
  return parts.join(BLANK);
}

class OMath2Latex {
  readonly latex: string;

  constructor(
    private readonly $: CheerioAPI,
    el: Cheerio<Element>,
  ) {
    this.latex = this.convert(el);
  }

  private convert(el: Cheerio<Element>): string {
    const tag = localName(el.get(0)!);
    switch (tag) {
      case "oMath":
        return processChildren(this.$, el);
      case "r": {
        const texts: string[] = [];
        for (const child of childElements(this.$, el)) {
          if (localName(child) === "t") {
            const s = this.$(child).text();
            for (const ch of s) texts.push(T[ch as keyof typeof T] ?? ch);
          }
        }
        return escapeLatex(texts.join(BLANK));
      }
      case "acc": {
        const c = childDict(this.$, el);
        const chr = el.find("*").filter((_, n) => localName(n) === "chr").first();
        const latexS = getVal(chr.attr("m:val") ?? chr.attr("val"), CHR_DEFAULT.ACC_VAL, CHR);
        return latexS.replace("{0}", c.e ?? "");
      }
      case "bar": {
        const c = childDict(this.$, el);
        const pr = Pr.from(this.$, el.children().filter((_, n) => localName(n) === "barPr").first());
        const latexS = getVal(pr.pos, POS_DEFAULT.BAR_VAL, POS);
        return pr.text + latexS.replace("{0}", c.e ?? "");
      }
      case "d": {
        const c = childDict(this.$, el);
        const pr = Pr.from(this.$, el.children().filter((_, n) => localName(n) === "dPr").first());
        const nullVal = D_DEFAULT.null;
        const left = getVal(pr.begChr, D_DEFAULT.left, T);
        const right = getVal(pr.endChr, D_DEFAULT.right, T);
        return (
          pr.text +
          D.replace("{left}", left ? escapeLatex(left) : nullVal)
            .replace("{text}", c.e ?? "")
            .replace("{right}", right ? escapeLatex(right) : nullVal)
        );
      }
      case "sub":
        return SUB.replace("{0}", processChildren(this.$, el));
      case "sup":
        return SUP.replace("{0}", processChildren(this.$, el));
      case "f": {
        const c = childDict(this.$, el);
        const pr = Pr.from(this.$, el.children().filter((_, n) => localName(n) === "fPr").first());
        const latexS = getVal(pr.type, F_DEFAULT, F as unknown as Record<string, string>);
        return pr.text + latexS.replace("{num}", c.num ?? "").replace("{den}", c.den ?? "");
      }
      case "func": {
        const c = childDict(this.$, el);
        return (c.fName ?? "").replace(FUNC_PLACE, c.e ?? "");
      }
      case "fName": {
        const parts: string[] = [];
        for (const child of childElements(this.$, el)) {
          const tag = localName(child);
          if (tag === "r") {
            const t = this.$(child).find("*").filter((_, n) => localName(n) === "t").text();
            parts.push(FUNC[t as keyof typeof FUNC] ?? t);
          } else {
            parts.push(new OMath2Latex(this.$, this.$(child)).latex);
          }
        }
        const t = parts.join(BLANK);
        return t.includes(FUNC_PLACE) ? t : t + FUNC_PLACE;
      }
      case "groupChr": {
        const c = childDict(this.$, el);
        const pr = Pr.from(this.$, el.children().filter((_, n) => localName(n) === "groupChrPr").first());
        const latexS = getVal(pr.chr, "{0}");
        return pr.text + latexS.replace("{0}", c.e ?? "");
      }
      case "rad": {
        const c = childDict(this.$, el);
        if (c.deg) return RAD.replace("{deg}", c.deg).replace("{text}", c.e ?? "");
        return RAD_DEFAULT.replace("{text}", c.e ?? "");
      }
      case "eqArr":
        return ARR.replace(
          "{text}",
          childElements(this.$, el)
            .filter((n) => localName(n) === "e")
            .map((n) => new OMath2Latex(this.$, this.$(n)).latex)
            .join(BRK),
        );
      case "limLow": {
        const c = childDict(this.$, el, ["e", "lim"]);
        const latexS = LIM_FUNC[c.e as keyof typeof LIM_FUNC];
        if (!latexS) return c.e ?? "";
        return latexS.replace("{lim}", c.lim ?? "");
      }
      case "limUpp": {
        const c = childDict(this.$, el, ["e", "lim"]);
        return LIM_UPP.replace("{lim}", c.lim ?? "").replace("{text}", c.e ?? "");
      }
      case "lim":
        return processChildren(this.$, el).replace(LIM_TO[0], LIM_TO[1]);
      case "m": {
        const rows = childElements(this.$, el)
          .filter((n) => localName(n) === "mr")
          .map((n) => new OMath2Latex(this.$, this.$(n)).latex);
        return M.replace("{text}", rows.join(BRK));
      }
      case "mr":
        return childElements(this.$, el)
          .filter((n) => localName(n) === "e")
          .map((n) => new OMath2Latex(this.$, this.$(n)).latex)
          .join(ALN);
      case "nary": {
        let bo = "";
        const parts: string[] = [];
        for (const child of childElements(this.$, el)) {
          const tag = localName(child);
          if (tag === "naryPr") {
            const pr = Pr.from(this.$, this.$(child));
            bo = getVal(pr.chr, "", CHR_BO as unknown as Record<string, string>);
          } else {
            parts.push(new OMath2Latex(this.$, this.$(child)).latex);
          }
        }
        return bo + BLANK + parts.join(BLANK);
      }
      default:
        return processChildren(this.$, el);
    }
  }
}

export function oMathElementToLatex(omathXml: string): string {
  const wrapped = omathXml.includes("<w:document")
    ? omathXml
    : `<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${omathXml}</w:document>`;
  const $ = load(wrapped, { xml: true });
  const oMath = $("*").filter((_, el) => localName(el) === "oMath").first();
  if (!oMath.length) return "";
  return new OMath2Latex($, oMath).latex;
}
