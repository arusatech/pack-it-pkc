import { describe, expect, it } from "vitest";
import {
  dedupeAdjacentChemistryBlocks,
  polishStudyChatReply,
} from "../src/pkc/study-chat/polish.js";

const EQ = "Zn(s) + Cu^{2+}(aq) -> Zn^{2+}(aq) + Cu(s)";

describe("dedupeAdjacentChemistryBlocks", () => {
  it("collapses bare \\ce{…}\\ce{…}", () => {
    const input = `\\ce{${EQ}}\\ce{${EQ}}`;
    expect(dedupeAdjacentChemistryBlocks(input)).toBe(`\\ce{${EQ}}`);
  });

  it("collapses $\\ce{…}$$\\ce{…}$", () => {
    const input = `$\\ce{${EQ}}$$\\ce{${EQ}}$`;
    expect(dedupeAdjacentChemistryBlocks(input)).toBe(`$\\ce{${EQ}}$`);
  });

  it("collapses mixed $ wrap then bare", () => {
    const input = `$\\ce{${EQ}}$\\ce{${EQ}}`;
    expect(dedupeAdjacentChemistryBlocks(input)).toBe(`$\\ce{${EQ}}$`);
  });
});

describe("polishStudyChatReply", () => {
  it("dedupes duplicated Daniell reaction in a chat reply", () => {
    const input =
      `This cell converts chemical energy. $\\ce{${EQ}}$$\\ce{${EQ}}$ We studied the Daniell cell.`;
    const out = polishStudyChatReply(input);
    const count = (out.match(/\\ce\{/g) ?? []).length;
    expect(count).toBe(1);
    expect(out).toContain(EQ);
  });
});
