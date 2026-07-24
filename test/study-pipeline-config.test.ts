import { describe, expect, it, vi, afterEach } from "vitest";
import {
  DEFAULT_STUDY_PIPELINE_CONFIG,
  resolveStudyPipelineConfig,
} from "../src/pkc/study-rag-config.js";
import { chunkStudyBlocks } from "../src/pkc/study-chunk.js";
import * as replyMod from "../src/pkc/study-chat/reply.js";
import * as sessionMod from "../src/inference/model-session.js";
import { answerStudyQuestion } from "../src/pkc/study-chat/answer.js";
import { clearStudyVectorIndexCache, retrieveStudyContext } from "../src/pkc/study-chat/retrieve.js";
import type { GgufInferenceProvider } from "../src/inference/types.js";
import type { PkcStudyDocument } from "../src/pkc/study-types.js";
import { PKC_STUDY_VERSION } from "../src/pkc/study-types.js";

describe("resolveStudyPipelineConfig", () => {
  it("returns defaults when no overrides", () => {
    const cfg = resolveStudyPipelineConfig();
    expect(cfg).toEqual(DEFAULT_STUDY_PIPELINE_CONFIG);
    expect(cfg).not.toBe(DEFAULT_STUDY_PIPELINE_CONFIG);
  });

  it("merges partial host overrides", () => {
    const cfg = resolveStudyPipelineConfig({
      fuseTopK: 4,
      temperature: 0.05,
      nPredict: 160,
      chatNCtx: 1024,
      embeddingDimensions: 384,
    });
    expect(cfg.fuseTopK).toBe(4);
    expect(cfg.temperature).toBe(0.05);
    expect(cfg.nPredict).toBe(160);
    expect(cfg.chatNCtx).toBe(1024);
    expect(cfg.embeddingDimensions).toBe(384);
    expect(cfg.chunkSizeTokens).toBe(DEFAULT_STUDY_PIPELINE_CONFIG.chunkSizeTokens);
    expect(cfg.vectorTopK).toBe(DEFAULT_STUDY_PIPELINE_CONFIG.vectorTopK);
  });

  it("clamps maxReplyWords to 10–500", () => {
    expect(resolveStudyPipelineConfig({ maxReplyWords: 3 }).maxReplyWords).toBe(10);
    expect(resolveStudyPipelineConfig({ maxReplyWords: 900 }).maxReplyWords).toBe(500);
    expect(resolveStudyPipelineConfig({ maxReplyWords: 250 }).maxReplyWords).toBe(250);
    expect(DEFAULT_STUDY_PIPELINE_CONFIG.maxReplyWords).toBe(500);
    expect(DEFAULT_STUDY_PIPELINE_CONFIG.maxReplySentences).toBe(40);
  });
});

describe("chunkStudyBlocks with pipeline", () => {
  it("honors smaller chunk size from host", () => {
    const blocks = [
      {
        id: "b1",
        page: 1,
        kind: "text" as const,
        content:
          "Alpha sentence one is long enough to keep. Beta sentence two is also long enough. Gamma sentence three finishes the pack.",
        bbox: { x: 0, y: 0, w: 1, h: 1 },
      },
    ];
    const tiny = chunkStudyBlocks(blocks, { chunkSizeTokens: 8, chunkOverlapTokens: 0 });
    const big = chunkStudyBlocks(blocks, { chunkSizeTokens: 512, chunkOverlapTokens: 0 });
    expect(tiny.length).toBeGreaterThanOrEqual(big.length);
  });
});

function makeDoc(overrides?: Partial<PkcStudyDocument>): PkcStudyDocument {
  return {
    version: PKC_STUDY_VERSION,
    title: "t",
    source: "s",
    createdAt: "2026-01-01T00:00:00.000Z",
    markdown: "Zinc metal displaces copper ions from aqueous copper sulfate solution.",
    blocks: [],
    chunks: [
      {
        chunkId: "c1",
        blockId: "b1",
        page: 1,
        kind: "text",
        text: "Zinc metal displaces copper ions from aqueous copper sulfate solution.",
        embedding: [],
      },
    ],
    flashCards: [],
    mcqs: [],
    games: [],
    models: { embedding: null, chat: null },
    stats: {
      blockCount: 0,
      chunkCount: 1,
      embeddedChunkCount: 0,
      flashCardCount: 0,
      mcqCount: 0,
      gameCount: 0,
    },
    ...overrides,
  };
}

describe("retrieveStudyContext pipeline overrides", () => {
  afterEach(() => {
    clearStudyVectorIndexCache();
  });

  it("uses fuseTopK from pipeline for bm25-only", async () => {
    const doc = makeDoc({
      chunks: [
        {
          chunkId: "c1",
          blockId: "b1",
          page: 1,
          kind: "text",
          text: "Zinc metal displaces copper ions from aqueous copper sulfate solution in redox.",
          embedding: [],
        },
        {
          chunkId: "c2",
          blockId: "b2",
          page: 1,
          kind: "text",
          text: "Copper sulfate is a blue crystalline salt used in electrochemistry labs.",
          embedding: [],
        },
        {
          chunkId: "c3",
          blockId: "b3",
          page: 1,
          kind: "text",
          text: "Aqueous copper ions accept electrons and deposit as copper metal.",
          embedding: [],
        },
        {
          chunkId: "c4",
          blockId: "b4",
          page: 1,
          kind: "text",
          text: "Zinc is higher in the reactivity series than copper for displacement.",
          embedding: [],
        },
      ],
      stats: {
        blockCount: 0,
        chunkCount: 4,
        embeddedChunkCount: 0,
        flashCardCount: 0,
        mcqCount: 0,
        gameCount: 0,
      },
    });

    const result = await retrieveStudyContext(doc, "zinc copper displacement", {
      useVectors: false,
      pipeline: { fuseTopK: 1, minLexicalOverlap: 0.1 },
    });

    if (result.mode !== "no-match") {
      expect(result.ranked.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("answerStudyQuestion pipeline generation knobs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearStudyVectorIndexCache();
  });

  it("passes temperature and nPredict from pipeline to complete()", async () => {
    vi.spyOn(replyMod, "extractStudyReplyFromContext").mockReturnValue(null);
    vi.spyOn(sessionMod, "ensureModelReady").mockResolvedValue({
      modelId: "smol",
      path: "/tmp/x.gguf",
    });

    const complete = vi.fn(async () => "Zinc displaces copper ions from copper sulfate.");
    const provider = {
      platform: "capacitor" as const,
      loadModel: vi.fn(async () => undefined),
      complete,
    } satisfies GgufInferenceProvider;

    const doc = makeDoc({
      chunks: [
        {
          chunkId: "c1",
          blockId: "b1",
          page: 1,
          kind: "text",
          text: "Zinc metal displaces copper ions from aqueous copper sulfate solution during a redox reaction in the laboratory.",
          embedding: [],
        },
      ],
    });

    const result = await answerStudyQuestion({
      doc,
      query: "zinc copper sulfate",
      provider,
      useVectors: false,
      pipeline: {
        temperature: 0.05,
        nPredict: 77,
        temperatureRetry: 0.15,
        minLexicalOverlap: 0.1,
        fuseTopK: 3,
      },
    });

    expect(result.mode).toBe("generative");
    expect(complete).toHaveBeenCalled();
    const opts = complete.mock.calls[0]![1];
    expect(opts?.temperature).toBe(0.05);
    expect(opts?.maxTokens).toBe(77);
    expect(sessionMod.ensureModelReady).toHaveBeenCalledWith(
      provider,
      expect.anything(),
      expect.objectContaining({ nCtx: DEFAULT_STUDY_PIPELINE_CONFIG.chatNCtx }),
    );
  });

  it("passes chatNCtx override into ensureModelReady", async () => {
    vi.spyOn(replyMod, "extractStudyReplyFromContext").mockReturnValue(null);
    const ready = vi.spyOn(sessionMod, "ensureModelReady").mockResolvedValue({
      modelId: "smol",
      path: "/tmp/x.gguf",
    });
    const complete = vi.fn(async () => "Zinc displaces copper.");
    const provider = {
      platform: "capacitor" as const,
      loadModel: vi.fn(async () => undefined),
      complete,
    } satisfies GgufInferenceProvider;

    await answerStudyQuestion({
      doc: makeDoc(),
      query: "zinc copper sulfate",
      provider,
      useVectors: false,
      pipeline: {
        chatNCtx: 1024,
        minLexicalOverlap: 0.1,
        temperature: 0.1,
        nPredict: 64,
      },
    });

    expect(ready).toHaveBeenCalledWith(
      provider,
      expect.anything(),
      expect.objectContaining({ nCtx: 1024 }),
    );
  });
});
