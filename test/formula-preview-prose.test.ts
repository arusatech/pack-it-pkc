import { describe, expect, it } from "vitest";
import {
  mountFormulaPreview,
  prepareContentForAutoRender,
} from "../src/pdf/katex-service.js";
import { looksLikeChemistry, isMostlyProse } from "../src/pdf/chemistry-normalize.js";

describe("formula preview prose safety", () => {
  const prose =
    "to electrical energy and has an electrical potential equal to 1.1 V when concentration of Zn";

  it("treats long OCR sentence as prose, not chemistry", () => {
    expect(isMostlyProse(prose)).toBe(true);
    expect(looksLikeChemistry(prose)).toBe(false);
  });

  it("strips mistaken \\ce{prose} wrappers before preview", () => {
    const prepared = prepareContentForAutoRender(`\\ce{${prose}}`);
    expect(prepared).not.toMatch(/\\ce\{/);
    expect(prepared).toContain("electrical");
    expect(prepared).toContain(" ");
  });

  it("mountFormulaPreview keeps spaces for prose (does not KaTeX-jam words)", () => {
    let html = "";
    let text = "";
    const el = {
      get innerHTML() {
        return html;
      },
      set innerHTML(v: string) {
        html = v;
        text = v.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
      },
      get textContent() {
        return text;
      },
      set textContent(v: string) {
        text = v;
        html = v;
      },
      querySelector: () => null,
    } as unknown as HTMLElement;

    // Simulate the old editor path that wrapped everything in \\ce{…}
    mountFormulaPreview(el, `\\ce{${prose}}`);
    expect(el.textContent).toContain("to electrical energy");
    expect(el.textContent).not.toMatch(/toelectricalenergy/);
    expect(el.innerHTML).not.toContain("katex");
  });

  it("still recognizes real reactions as chemistry", () => {
    const reaction = "Zn(s) + Cu^{2+}(aq) -> Zn^{2+}(aq) + Cu(s)";
    expect(looksLikeChemistry(reaction)).toBe(true);
    const prepared = prepareContentForAutoRender(`\\ce{${reaction}}`);
    expect(prepared).toMatch(/\\ce\{/);
  });
});
