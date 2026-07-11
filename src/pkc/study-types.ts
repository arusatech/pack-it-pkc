/** Study PKC schema (version 2) — self-contained RAG + flash + MCQ export. */

export const PKC_STUDY_VERSION = 2 as const;

export type StudyBlockKind =
  | "text"
  | "heading"
  | "list"
  | "table"
  | "image"
  | "qa"
  | "formula"
  | "math";

export interface StudyBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StudyBlock {
  id: string;
  page: number;
  kind: StudyBlockKind;
  title?: string;
  content: string;
  bbox: StudyBBox;
  contentFormat?: "plain" | "mhchem" | "mixed" | "latex";
  question?: string;
  answer?: string;
  dataUrl?: string;
}

export interface RagChunk {
  chunkId: string;
  blockId: string;
  page: number;
  kind: StudyBlockKind;
  text: string;
  /** Dense vector; empty when embeddings were skipped. */
  embedding: number[];
}

export interface FlashCard {
  id: string;
  blockId: string;
  page: number;
  info: string;
  solution: {
    text: string;
    imageIds?: string[];
  };
}

export interface Mcq {
  id: string;
  blockId: string;
  page: number;
  question: string;
  options: [string, string, string, string];
  answerIndex: 0 | 1 | 2 | 3;
  explanation?: string;
}

export interface PkcStudyStats {
  blockCount: number;
  chunkCount: number;
  embeddedChunkCount: number;
  flashCardCount: number;
  mcqCount: number;
}

export interface PkcStudyDocument {
  version: typeof PKC_STUDY_VERSION;
  title?: string | null;
  source?: string | null;
  createdAt: string;
  markdown: string;
  blocks: StudyBlock[];
  chunks: RagChunk[];
  flashCards: FlashCard[];
  mcqs: Mcq[];
  models: {
    embedding?: string | null;
    chat?: string | null;
  };
  stats: PkcStudyStats;
  warnings?: string[];
}
