import { packStudyPkc, unpackStudyPkc } from "./pack-study.js";
import { normalizeStudyGames } from "./games/assemble-game.js";
import {
  PKC_STUDY_VERSION,
  type FlashCard,
  type Mcq,
  type PkcStudyDocument,
  type RagChunk,
  type StudyBlock,
  type StudyGame,
} from "./study-types.js";

export type MergeStudySource = {
  /** Display / section label (usually the source file name). */
  label: string;
  document: PkcStudyDocument;
};

export type MergeStudyDocumentsOptions = {
  /** Output title. Defaults to the first document's title (or first label). */
  title?: string | null;
  /** Output source field. Defaults to the first label. */
  source?: string | null;
};

function prefixId(docIdx: number, id: string): string {
  const safe = id && id.trim() ? id.trim() : `auto-${docIdx}`;
  // Avoid double-prefixing if already merged once.
  if (safe.startsWith(`m${docIdx}_`)) return safe;
  return `m${docIdx}_${safe}`;
}

function remapBlock(docIdx: number, block: StudyBlock): StudyBlock {
  return { ...block, id: prefixId(docIdx, block.id) };
}

function remapChunk(docIdx: number, chunk: RagChunk): RagChunk {
  return {
    ...chunk,
    chunkId: prefixId(docIdx, chunk.chunkId),
    blockId: prefixId(docIdx, chunk.blockId),
  };
}

function remapFlashCard(docIdx: number, card: FlashCard): FlashCard {
  return {
    ...card,
    id: prefixId(docIdx, card.id),
    blockId: prefixId(docIdx, card.blockId),
  };
}

function remapMcq(docIdx: number, mcq: Mcq): Mcq {
  return {
    ...mcq,
    id: prefixId(docIdx, mcq.id),
    blockId: prefixId(docIdx, mcq.blockId),
  };
}

function remapGame(docIdx: number, game: StudyGame): StudyGame {
  return {
    ...game,
    id: prefixId(docIdx, game.id),
  };
}

function sectionMarkdown(label: string, markdown: string): string {
  const body = (markdown ?? "").trim();
  const heading = `## Merged from: ${label}`;
  if (!body) return heading;
  return `${heading}\n\n${body}`;
}

/**
 * Merge two or more Study PKC documents into one.
 * Flash cards and MCQs are concatenated into their respective arrays (with
 * remapped ids so sources do not collide). Blocks, chunks, and games follow
 * the same pattern.
 */
export function mergeStudyDocuments(
  sources: MergeStudySource[],
  options: MergeStudyDocumentsOptions = {},
): PkcStudyDocument {
  if (sources.length < 2) {
    throw new Error("Merge requires at least 2 Study PKC documents");
  }

  const first = sources[0]!;
  const blocks: StudyBlock[] = [];
  const chunks: RagChunk[] = [];
  const flashCards: FlashCard[] = [];
  const mcqs: Mcq[] = [];
  const games: StudyGame[] = [];
  const markdownParts: string[] = [];
  const warnings: string[] = [];
  const embeddingModels = new Set<string>();
  const chatModels = new Set<string>();

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]!;
    const doc = src.document;
    if (doc.version !== PKC_STUDY_VERSION) {
      throw new Error(
        `Source "${src.label}" is not a Study PKC v${PKC_STUDY_VERSION} document (got version ${doc.version})`,
      );
    }

    markdownParts.push(sectionMarkdown(src.label, doc.markdown ?? ""));

    for (const b of doc.blocks ?? []) blocks.push(remapBlock(i, b));
    for (const c of doc.chunks ?? []) chunks.push(remapChunk(i, c));
    for (const f of doc.flashCards ?? []) flashCards.push(remapFlashCard(i, f));
    for (const m of doc.mcqs ?? []) mcqs.push(remapMcq(i, m));
    for (const g of doc.games ?? []) games.push(remapGame(i, g));

    if (doc.models?.embedding) embeddingModels.add(doc.models.embedding);
    if (doc.models?.chat) chatModels.add(doc.models.chat);
    if (doc.warnings?.length) {
      for (const w of doc.warnings) warnings.push(`[${src.label}] ${w}`);
    }
  }

  warnings.unshift(`Merged ${sources.length} Study PKC files: ${sources.map((s) => s.label).join(", ")}`);

  const mergedGames = normalizeStudyGames(games);

  return {
    version: PKC_STUDY_VERSION,
    title: options.title ?? first.document.title ?? first.label,
    source: options.source ?? first.label,
    createdAt: new Date().toISOString(),
    markdown: markdownParts.join("\n\n---\n\n"),
    blocks,
    chunks,
    flashCards,
    mcqs,
    games: mergedGames,
    models: {
      embedding: [...embeddingModels][0] ?? first.document.models?.embedding ?? null,
      chat: [...chatModels][0] ?? first.document.models?.chat ?? null,
      vectorIndex: first.document.models?.vectorIndex ?? null,
      embeddingDimensions: first.document.models?.embeddingDimensions ?? null,
    },
    stats: {
      blockCount: blocks.length,
      chunkCount: chunks.length,
      embeddedChunkCount: chunks.filter((c) => c.embedding?.length).length,
      flashCardCount: flashCards.length,
      mcqCount: mcqs.length,
      gameCount: mergedGames.length,
    },
    warnings,
  };
}

export type MergeStudyPkcBytesInput = {
  label: string;
  bytes: Uint8Array;
};

export type MergeStudyPkcFilesOptions = MergeStudyDocumentsOptions & {
  /**
   * Output file base name (no extension). When omitted, uses the first source
   * label with `.study.pkc` / `.pkc` stripped.
   */
  outputBaseName?: string | null;
};

function stemFromLabel(label: string): string {
  const name = label.replace(/\\/g, "/").split("/").pop() || label;
  return name
    .replace(/\.study\.pkc$/i, "")
    .replace(/\.pkc$/i, "")
    .replace(/\.study$/i, "");
}

/**
 * Unpack multiple Study PKC binaries, merge documents, and re-pack.
 * Returns the merged document, packed bytes, and a suggested `.study.pkc` filename.
 */
export function mergeStudyPkcFiles(
  inputs: MergeStudyPkcBytesInput[],
  options: MergeStudyPkcFilesOptions = {},
): { document: PkcStudyDocument; pkc: Uint8Array; filename: string } {
  if (inputs.length < 2) {
    throw new Error("Merge requires at least 2 Study PKC files");
  }

  const sources: MergeStudySource[] = inputs.map((input) => ({
    label: input.label,
    document: unpackStudyPkc(input.bytes),
  }));

  const document = mergeStudyDocuments(sources, {
    title: options.title,
    source: options.source ?? inputs[0]!.label,
  });
  const pkc = packStudyPkc(document);
  const base =
    (options.outputBaseName && options.outputBaseName.trim()) ||
    stemFromLabel(inputs[0]!.label) ||
    "merged";
  const filename = base.toLowerCase().endsWith(".study.pkc")
    ? base
    : `${base.replace(/\.pkc$/i, "")}.study.pkc`;

  return { document, pkc, filename };
}
