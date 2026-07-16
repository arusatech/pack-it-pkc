import { describe, expect, it } from "vitest";
import { createChessStudyDocument, createChessStudyPkc } from "../src/pkc/create-chess-pkc.js";
import { resolvePlayableGameHtml } from "../src/pkc/games/assemble-game.js";
import { packStudyPkc, unpackStudyPkc } from "../src/pkc/pack-study.js";
import type { PkcStudyDocument } from "../src/pkc/study-types.js";

describe("createChessStudyPkc", () => {
  it("packs a study PKC with chess module + legacy player", () => {
    const { document, pkc } = createChessStudyPkc({
      title: "Practice Chess",
      difficulty: 2,
      playerColor: "b",
    });

    expect(document.games).toHaveLength(1);
    expect(document.games[0]).toMatchObject({
      kind: "chess",
      difficulty: 2,
      playerColor: "b",
      config: { difficulty: 2, playerColor: "b", mode: "play" },
    });
    expect(document.stats.gameCount).toBe(1);
    expect(document.games[0]?.module?.documentHtml).toContain("<!DOCTYPE html>");
    expect(document.games[0]?.module?.documentHtml).toContain('id="board"');
    expect(document.games[0]?.player?.html).toContain("__PKC_CHESS__");

    const loaded = unpackStudyPkc(pkc);
    expect(loaded.games).toHaveLength(1);
    expect(loaded.stats.gameCount).toBe(1);
    expect(loaded.games[0]?.kind).toBe("chess");
    expect(loaded.games[0]?.module?.documentHtml).toContain("__PKC_CHESS__");
    const playable = resolvePlayableGameHtml(loaded.games[0]!);
    expect(playable).toContain('id="board"');
    // chess.js declares `class Chess`; load it in an inner IIFE to avoid redeclare.
    expect(playable).toContain("return module.exports.Chess");
    expect(playable).not.toContain("var Chess = module.exports.Chess");
  });

  it("can omit embedded module when requested", () => {
    const doc = createChessStudyDocument({ title: "Bare", embedPlayer: false });
    expect(doc.games[0]?.player).toBeUndefined();
    expect(doc.games[0]?.module).toBeUndefined();
  });

  it("normalizes missing games on unpack", () => {
    const base = createChessStudyDocument({ title: "Legacy" });
    const legacy = {
      ...base,
      games: undefined,
      stats: {
        blockCount: 0,
        chunkCount: 0,
        embeddedChunkCount: 0,
        flashCardCount: 0,
        mcqCount: 0,
      },
    } as unknown as PkcStudyDocument;

    const pkc = packStudyPkc(legacy);
    const loaded = unpackStudyPkc(pkc);
    expect(loaded.games).toEqual([]);
    expect(loaded.stats.gameCount).toBe(0);
  });

  it("upgrades packs that only have legacy player.html", () => {
    const base = createChessStudyDocument({ title: "Old shape", embedPlayer: false });
    const onlyPlayer = {
      ...base,
      games: [
        {
          kind: "chess",
          id: "chess-1",
          title: "Old shape",
          player: {
            mimeType: "text/html" as const,
            version: 1,
            html: "<!DOCTYPE html><html><body><div id=\"board\"></div></body></html>",
          },
        },
      ],
    } as PkcStudyDocument;

    const loaded = unpackStudyPkc(packStudyPkc(onlyPlayer));
    expect(loaded.games[0]?.module?.documentHtml).toContain('id="board"');
    expect(resolvePlayableGameHtml(loaded.games[0]!)).toContain('id="board"');
  });
});
