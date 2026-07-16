export {
  packToPkc,
  unpackPkc,
  packIt,
  PKC_MAGIC,
  PKC_VERSION,
  type PkcDocument,
  type PackOptions,
  type PackAndConvertOptions,
} from "./pack.js";

export {
  PKC_STUDY_VERSION,
  type StudyBlockKind,
  type StudyBBox,
  type StudyBlock,
  type RagChunk,
  type FlashCard,
  type Mcq,
  type PkcStudyStats,
  type PkcStudyDocument,
} from "./study-types.js";

export { packStudyPkc, unpackStudyPkc } from "./pack-study.js";
export { blocksToStudyDocumentParts } from "./study-from-blocks.js";
export { chunkStudyBlocks, splitSentences } from "./study-chunk.js";
export {
  generateFlashCards,
  generateMcqsFromFlashCards,
  type StudyCardProgress,
} from "./study-cards.js";
export {
  generateStudyPkc,
  type GenerateStudyPkcOptions,
  type GenerateStudyPkcResult,
} from "./generate-study-pkc.js";

export {
  loadPkcForChat,
  answerStudyQuestion,
  retrieveStudyContext,
  collectStudySearchChunks,
  resolveStudyChatImages,
  studyBm25,
  StudyBm25Index,
  fuseRankedLists,
  buildStudyRagChatPrompt,
  extractStudyReplyFromContext,
  clampStudyChatReply,
  buildStudyContextFallbackReply,
  STUDY_CHAT_RAG_CLAMP,
  STUDY_CHAT_RAG_N_PREDICT,
  STUDY_CHAT_RAG_STOP,
  STUDY_CHAT_NO_CONTEXT_FALLBACK,
  type AnswerStudyQuestionOptions,
  type AnswerStudyQuestionResult,
  type StudyRetrieveResult,
  type StudyRetrieveMode,
  type StudyChatImage,
  type RankedChunk,
  type Bm25Hit,
} from "./study-chat/index.js";
