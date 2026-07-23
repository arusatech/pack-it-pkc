import { describe, expect, it } from "vitest";

import {
  isMostlyProse,
  isRealChemistryFormula,
  looksLikeChemistry,
  normalizeChemistryInText,
  normalizeChemistryMarkupForStudy,
  plainChemistryToMhchem,
  stripSpuriousChemistryWraps,
} from "../src/pdf/chemistry-normalize.js";
import { prepareContentForAutoRender } from "../src/pdf/katex-service.js";

describe("formula region prose vs chemistry", () => {
  const galvanicProse =
    "to electrical energy and has an electrical potential equal to 1.1 V when concentration of Zn^{2+} and Cu^{2+} ions is unity (1 mol dm^{–3})^{*}. Such a device is called a galvanic or a voltaic cell.";

  it("does not treat galvanic-cell prose as a whole chemistry formula", () => {
    expect(looksLikeChemistry(galvanicProse)).toBe(false);
    expect(isMostlyProse(galvanicProse)).toBe(true);
  });

  it("does not wrap galvanic prose in a single \\ce{…}", () => {
    const out = plainChemistryToMhchem(galvanicProse);
    expect(out.startsWith("\\ce{")).toBe(false);
    expect(out).toContain("$\\ce{Zn^{2+}}$");
    expect(out).toContain("$\\ce{Cu^{2+}}$");
    expect(out).toMatch(/galvanic or a voltaic cell/);
  });

  it("still wraps a real redox equation in \\ce{…}", () => {
    const rxn = "Zn(s) + Cu2+(aq) -> Zn2+(aq) + Cu(s)";
    expect(plainChemistryToMhchem(rxn)).toBe(
      "\\ce{Zn(s) + Cu^{2+}(aq) -> Zn^{2+}(aq) + Cu(s)}",
    );
  });

  it("strips mistaken whole-paragraph \\ce wraps then promotes ions", () => {
    const broken = `\\ce{${galvanicProse}}`;
    const stripped = stripSpuriousChemistryWraps(broken);
    expect(stripped).not.toContain("\\ce{to electrical");
    const prepared = prepareContentForAutoRender(broken);
    expect(prepared).toContain("$\\ce{Zn^{2+}}$");
    expect(prepared).toContain("$\\ce{Cu^{2+}}$");
    expect(prepared).not.toMatch(/^\$\\ce\{to electrical/);
  });

  it("preserves user \\ce{ZnSO_{4}, CuSO_{4}} in text regions for study", () => {
    const edited = "Electrolyte is \\ce{ZnSO_{4} ,CuSO_{4}} in the cell.";
    const out = normalizeChemistryMarkupForStudy(edited);
    expect(out).toContain("$\\ce{ZnSO_{4}, CuSO_{4}}$");
    expect(out).toContain("Electrolyte is");
    expect(isRealChemistryFormula("ZnSO_{4}, CuSO_{4}")).toBe(true);
  });

  it("normalizeChemistryInText keeps prose and wraps ions", () => {
    const out = normalizeChemistryInText(galvanicProse);
    expect(out).toContain("$\\ce{Zn^{2+}}$");
    expect(out).toContain("voltaic cell");
  });
});
