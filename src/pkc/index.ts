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
  type StudyGameKind,
  type StudyGameDifficulty,
  type StudyGameBridgePermission,
  type StudyGameAsset,
  type StudyGameModule,
  type StudyGameBridge,
  type StudyGameSpec,
  type ChessGameSpec,
  type StudyGame,
  type StudyGamePlayer,
  type PkcStudyStats,
  type PkcStudyDocument,
} from "./study-types.js";

export { packStudyPkc, unpackStudyPkc } from "./pack-study.js";
export {
  STUDY_GAME_MODULE_VERSION,
  STUDY_GAME_MAX_DOCUMENT_BYTES,
  assembleGameDocument,
  normalizeStudyGame,
  normalizeStudyGames,
  resolvePlayableGameHtml,
  isPlayableStudyGame,
  type AssembleGameDocumentOptions,
} from "./games/assemble-game.js";
export {
  createChessStudyDocument,
  createChessStudyPkc,
  type CreateChessStudyPkcOptions,
} from "./create-chess-pkc.js";
export {
  createCustomStudyDocument,
  createCustomStudyPkc,
  type CreateCustomStudyPkcOptions,
} from "./create-custom-pkc.js";
export {
  buildChessCartridgeHtml,
  buildChessGamePlayer,
  CHESS_PLAYER_VERSION,
  type ChessPlayerConfig,
} from "./games/chess/build-chess-player-html.js";
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
  polishStudyChatReply,
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
