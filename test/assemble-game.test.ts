import { describe, expect, it } from "vitest";
import {
  assembleGameDocument,
  isPlayableStudyGame,
  normalizeStudyGame,
  resolvePlayableGameHtml,
} from "../src/pkc/games/assemble-game.js";
import { createCustomStudyPkc } from "../src/pkc/create-custom-pkc.js";
import { unpackStudyPkc } from "../src/pkc/pack-study.js";

describe("assembleGameDocument", () => {
  it("stitches html/css/js and injects __PKC_GAME__", () => {
    const html = assembleGameDocument(
      {
        version: 1,
        css: "body { color: red; }",
        html: '<div id="app">Hi</div>',
        js: 'document.getElementById("app").textContent = window.__PKC_GAME__.config.label;',
      },
      { title: "Hello", kind: "custom", id: "g1", config: { label: "World" } },
    );

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("body { color: red; }");
    expect(html).toContain('id="app"');
    expect(html).toContain("__PKC_GAME__");
    expect(html).toContain('"label":"World"');
  });

  it("prefers documentHtml when present and injects boot if no scripts", () => {
    const html = assembleGameDocument(
      {
        version: 1,
        documentHtml: "<!DOCTYPE html><html><body>READY</body></html>",
        html: "<div>ignored</div>",
      },
      { title: "Doc" },
    );
    expect(html).toContain("READY");
    expect(html).toContain("__PKC_GAME__");
    expect(html).not.toContain("ignored");
  });

  it("does not inject into self-contained documents with scripts", () => {
    const html = assembleGameDocument(
      {
        version: 1,
        documentHtml:
          '<!DOCTYPE html><html><head></head><body><script>window.__PKC_CHESS__={};</script></body></html>',
      },
      { config: { a: 1 } },
    );
    expect(html).toContain("__PKC_CHESS__");
    expect(html).not.toContain("__PKC_GAME__");
  });
});

describe("normalizeStudyGame / resolvePlayableGameHtml", () => {
  it("upgrades legacy player.html to module", () => {
    const normalized = normalizeStudyGame({
      kind: "chess",
      id: "c1",
      player: {
        mimeType: "text/html",
        version: 1,
        html: "<!DOCTYPE html><html><body>legacy</body></html>",
      },
    });
    expect(normalized.module?.documentHtml).toContain("legacy");
    expect(normalized.config).toMatchObject({ playerColor: "w", difficulty: 3 });
    expect(isPlayableStudyGame(normalized)).toBe(true);
    expect(resolvePlayableGameHtml(normalized)).toContain("legacy");
  });

  it("returns null when no executable module", () => {
    expect(
      resolvePlayableGameHtml({ kind: "custom", id: "x", title: "Empty" }),
    ).toBeNull();
    expect(isPlayableStudyGame({ kind: "custom", id: "x" })).toBe(false);
  });
});

describe("createCustomStudyPkc", () => {
  it("packs a custom html/css/js cartridge", () => {
    const { document, pkc } = createCustomStudyPkc({
      title: "Hello Game",
      kind: "hello",
      config: { clicks: 0 },
      css: "button { font-size: 1.2rem; }",
      html: '<main><h1 id="t">Hello</h1><button id="b" type="button">Click</button></main>',
      js: `
        var boot = window.__PKC_GAME__;
        document.getElementById("b").onclick = function() {
          parent.postMessage({ source: "pkc-game", type: "close" }, "*");
        };
        parent.postMessage({ source: "pkc-game", type: "ready", title: boot.title }, "*");
      `,
    });

    expect(document.games[0]?.kind).toBe("hello");
    expect(document.games[0]?.module?.html).toContain('id="b"');
    expect(document.games[0]?.module?.css).toContain("button");
    expect(document.games[0]?.config).toEqual({ clicks: 0 });

    const loaded = unpackStudyPkc(pkc);
    const playable = resolvePlayableGameHtml(loaded.games[0]!);
    expect(playable).toContain("__PKC_GAME__");
    expect(playable).toContain("Hello Game");
    expect(playable).toContain('id="b"');
  });
});
