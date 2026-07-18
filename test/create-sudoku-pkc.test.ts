import { describe, expect, it } from "vitest";
import { createSudokuStudyPkc } from "../src/pkc/create-sudoku-pkc.js";
import { resolvePlayableGameHtml } from "../src/pkc/games/assemble-game.js";
import { unpackStudyPkc } from "../src/pkc/pack-study.js";

describe("createSudokuStudyPkc", () => {
  it("packs a sudoku cartridge with module parts", () => {
    const { document, pkc } = createSudokuStudyPkc({
      title: "Sudoku",
      level: 2,
      difficulty: "medium",
    });

    const game = document.games[0]!;
    expect(game.kind).toBe("sudoku");
    expect(game.config).toMatchObject({ level: 2, difficulty: "medium" });
    expect(game.module?.html).toContain('id="board"');
    expect(game.module?.css).toContain(".cell");
    expect(game.module?.js).toContain("generateComplete");
    expect(document.stats.gameCount).toBe(1);

    const loaded = unpackStudyPkc(pkc);
    const html = resolvePlayableGameHtml(loaded.games[0]!);
    expect(html).toContain("__PKC_GAME__");
    expect(html).toContain('"difficulty":"medium"');
    expect(html).toContain('id="board"');
  });

  it("sudoku JS parses and boots against a DOM stub", () => {
    const { document: doc } = createSudokuStudyPkc({ title: "Sudoku" });
    const js = doc.games[0]!.module!.js!;

    const posts: unknown[] = [];
    const makeEl = (): Record<string, unknown> => {
      const el: Record<string, unknown> = {
        textContent: "",
        innerHTML: "",
        className: "",
        type: "",
        hidden: false,
        disabled: false,
        style: {},
        setAttribute() {},
        addEventListener() {},
        appendChild() {},
      };
      return el;
    };
    const fakeDocument = {
      getElementById: () => makeEl(),
      createElement: () => makeEl(),
      addEventListener() {},
    };
    const fakeParent = {
      postMessage: (msg: unknown) => posts.push(msg),
    };
    const fakeWindow = {
      __PKC_GAME__: { title: "Sudoku", config: { level: 1, difficulty: "easy" } },
      parent: fakeParent,
    };

    const fn = new Function("window", "document", "parent", js);
    fn(fakeWindow, fakeDocument, fakeParent);

    expect(posts).toContainEqual(
      expect.objectContaining({ source: "pkc-game", type: "ready" }),
    );
  });
});
