export {
  packToPkc,
  unpackPkc,
  packPkcJson,
  unpackPkcJson,
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
  mergeStudyDocuments,
  mergeStudyPkcFiles,
  type MergeStudySource,
  type MergeStudyDocumentsOptions,
  type MergeStudyPkcBytesInput,
  type MergeStudyPkcFilesOptions,
} from "./merge-study-pkc.js";
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
  createBallSortStudyDocument,
  createBallSortStudyPkc,
  type CreateBallSortStudyPkcOptions,
} from "./create-ball-sort-pkc.js";
export {
  buildBallSortModule,
  BALL_SORT_VERSION,
  type BallSortConfig,
} from "./games/ball-sort/build-ball-sort-module.js";
export {
  createSudokuStudyDocument,
  createSudokuStudyPkc,
  type CreateSudokuStudyPkcOptions,
} from "./create-sudoku-pkc.js";
export {
  buildSudokuModule,
  SUDOKU_VERSION,
  type SudokuConfig,
  type SudokuDifficulty,
} from "./games/sudoku/build-sudoku-module.js";
export {
  buildChessCartridgeHtml,
  buildChessGamePlayer,
  CHESS_PLAYER_VERSION,
  type ChessPlayerConfig,
} from "./games/chess/build-chess-player-html.js";
export { blocksToStudyDocumentParts } from "./study-from-blocks.js";
export { chunkStudyBlocks, splitSentences, packSentencesIntoChunks, type ChunkStudyBlocksOptions } from "./study-chunk.js";
export {
  STUDY_CHUNK_SIZE_TOKENS,
  STUDY_CHUNK_OVERLAP_TOKENS,
  STUDY_RAG_VECTOR_TOP_K,
  STUDY_RAG_BM25_TOP_K,
  STUDY_RAG_FUSE_TOP_K,
  STUDY_RAG_MIN_VECTOR_SCORE,
  STUDY_RAG_MIN_LEXICAL_OVERLAP,
  STUDY_RAG_TEMPERATURE,
  STUDY_RAG_TEMPERATURE_RETRY,
  STUDY_RAG_N_PREDICT,
  USEARCH_CONNECTIVITY,
  USEARCH_EXPANSION_ADD,
  USEARCH_EXPANSION_SEARCH,
  DEFAULT_STUDY_PIPELINE_CONFIG,
  resolveStudyPipelineConfig,
  STUDY_REPLY_WORDS_MIN,
  STUDY_REPLY_WORDS_MAX,
  estimateTokenCount,
  tokensToCharBudget,
  type StudyPipelineConfig,
} from "./study-rag-config.js";
export {
  generateFlashCards,
  generateMcqsFromFlashCards,
  buildFlashCardUnits,
  type StudyCardProgress,
} from "./study-cards.js";
export {
  generateStudyPkc,
  type GenerateStudyPkcOptions,
  type GenerateStudyPkcResult,
} from "./generate-study-pkc.js";
export {
  markdownToStudyBlocks,
  type MarkdownToStudyBlocksOptions,
} from "./markdown-to-study-blocks.js";
export {
  generateStudyPkcFromBytes,
  type GenerateStudyPkcFromBytesMeta,
  type GenerateStudyPkcFromBytesOptions,
} from "./generate-study-pkc-from-bytes.js";

export {
  loadPkcForChat,
  answerStudyQuestion,
  retrieveStudyContext,
  collectStudySearchChunks,
  clearStudyVectorIndexCache,
  resolveStudyChatImages,
  studyBm25,
  StudyBm25Index,
  fuseRankedLists,
  assessStudyRetrievalRelevance,
  buildStudyRagChatPrompt,
  extractStudyReplyFromContext,
  clampStudyChatReply,
  polishStudyChatReply,
  buildStudyContextFallbackReply,
  formatStudyHtml,
  STUDY_CHAT_RAG_CLAMP,
  STUDY_CHAT_RAG_N_PREDICT,
  STUDY_CHAT_RAG_STOP,
  STUDY_CHAT_NO_CONTEXT_FALLBACK,
  type AnswerStudyQuestionOptions,
  type AnswerStudyQuestionResult,
  type StudyRetrieveResult,
  type StudyRetrieveMode,
  type RetrieveStudyContextOptions,
  type StudyChatImage,
  type RankedChunk,
  type Bm25Hit,
} from "./study-chat/index.js";

export {
  createStudyVectorIndex,
  createExactStudyVectorIndex,
  ExactCosineIndex,
  USearchVectorIndex,
  type StudyVectorBackend,
  type StudyVectorHit,
  type StudyVectorIndex,
  type StudyVectorRecord,
  type CreateStudyVectorIndexOptions,
  type USearchHnswOptions,
} from "./vector/index.js";
