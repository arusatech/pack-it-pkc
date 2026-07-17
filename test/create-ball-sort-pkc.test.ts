import { describe, expect, it } from "vitest";
import { createBallSortStudyPkc } from "../src/pkc/create-ball-sort-pkc.js";
import { resolvePlayableGameHtml } from "../src/pkc/games/assemble-game.js";
import { unpackStudyPkc } from "../src/pkc/pack-study.js";

describe("createBallSortStudyPkc", () => {
  it("packs a ball sort cartridge with module parts", () => {
    const { document, pkc } = createBallSortStudyPkc({
      title: "Ball Sort",
      level: 2,
      colors: 5,
    });

    const game = document.games[0]!;
    expect(game.kind).toBe("ball-sort");
    expect(game.config).toMatchObject({ level: 2, colors: 5, tubeSize: 4 });
    expect(game.module?.html).toContain('id="tubes"');
    expect(game.module?.css).toContain(".tube");
    expect(game.module?.js).toContain("generateLevel");
    expect(document.stats.gameCount).toBe(1);

    const loaded = unpackStudyPkc(pkc);
    const html = resolvePlayableGameHtml(loaded.games[0]!);
    expect(html).toContain("__PKC_GAME__");
    expect(html).toContain('"level":2');
    expect(html).toContain('id="tubes"');
  });

  it("ball sort JS parses and boots against a DOM stub", async () => {
    const { document: doc } = createBallSortStudyPkc({ title: "Ball Sort" });
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
    };
    const fakeParent = {
      postMessage: (msg: unknown) => posts.push(msg),
    };
    const fakeWindow = {
      __PKC_GAME__: { title: "Ball Sort", config: { level: 1 } },
      parent: fakeParent,
    };

    const fn = new Function("window", "document", "parent", js);
    fn(fakeWindow, fakeDocument, fakeParent);

    expect(posts).toContainEqual(
      expect.objectContaining({ source: "pkc-game", type: "ready" }),
    );
  });
});
