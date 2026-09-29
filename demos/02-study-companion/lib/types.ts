/** Shapes returned by the Python backend (backend/app.py). */

export type RetrievalMode = "hybrid" | "keyword" | "semantic";
export type Chunking = "section" | "fixed";
export type Level = "simple" | "standard" | "exam";
export type PracticeKind = "quiz" | "flashcards" | "recall";

export interface Health {
  status: "ok";
  apiVersion: number;
  name: string;
  generation: boolean;
  model: string;
  provider: string;
  fallbackModels: string[];
  embeddings: { status: "off" | "loading" | "ready" | "failed"; model: string };
  ocr: { engine: string; enabled: boolean };
  retrieval: { modes: RetrievalMode[]; default: RetrievalMode };
  chunking: { modes: Chunking[]; default: Chunking; sectionMaxWords: number };
  practice: { kinds: PracticeKind[]; count: [number, number] };
  limits: { fileBytes: number; documents: number };
}

export interface Overview {
  summary: string;
  keyTerms: string[];
  questions: string[];
  model: string;
}

export interface DocumentSummary {
  id: string;
  name: string;
  format: "pdf" | "word" | "text" | "sample";
  bytes: number;
  addedAt: string;
  pages: number;
  sections: number;
  words: number;
  characters: number;
  ocrPages: number;
  imageRegions: number;
  ocrFailed: boolean;
  truncated: boolean;
  embeddings: boolean;
  sample: boolean;
  overview: Overview | null;
}

/** One heading of the notes and the text under it. */
export interface Section {
  id: string;
  title: string;
  text: string;
  location: string;
  pages: [number, number] | null;
  words: number;
  ocr: boolean;
  heading: string;
  part: number;
  parts: number;
}

export interface ChunkStats {
  count: number;
  averageWords: number;
  minWords: number;
  maxWords: number;
}

export interface DocumentDetail extends Omit<
  DocumentSummary,
  "embeddings" | "sections"
> {
  version: string;
  extraction: {
    pageCount: number;
    pages: {
      page: number;
      chars: number;
      method: "text" | "ocr" | "text+ocr" | "empty";
    }[];
    blocks: number;
    characters: number;
    textPages: number;
    ocrPages: number;
    imageRegions: number;
    emptyPages: number;
    ocrFailed: boolean;
    ocrEngine: string | null;
  };
  sectioning: {
    maxWords: number | null;
    headings: number;
    splitHeadings: number;
  };
  chunking: {
    section: ChunkStats;
    /** A last window under `minTailWords` joins the window before it. */
    fixed: ChunkStats & { chunkWords: number; minTailWords: number };
  };
  index: {
    engine: string;
    words: number;
    vocabulary: number;
    topTerms: { term: string; count: number }[];
  };
  embeddings: { model: string; dimensions: number; sample?: number[] } | null;
  timings: {
    extractMs?: number;
    sectionMs?: number;
    embedMs?: number;
    indexMs?: number;
  };
  sections: Section[];
}

export type UploadStage =
  "reading" | "text" | "ocr" | "sectioning" | "embedding" | "indexing";

export interface UploadProgress {
  fileName: string;
  stage: UploadStage;
  done?: number;
  total?: number;
  /** Whether OCR ran at any point during this upload. */
  sawOcr?: boolean;
  /** Position in the current upload queue (1-based) and its size. */
  index: number;
  count: number;
}

export interface SampleQuestion {
  id: string;
  category: string;
  question: string;
  previous?: string;
  expected_sections?: string[];
  expected_status?: string;
  exception_check?: string;
}

export interface SampleInfo {
  documents: { id: string; title: string; sections: number }[];
  loaded: boolean;
  questions: SampleQuestion[];
  provenance: string;
}

export interface Prefs {
  level: Level;
  instructions: string;
  notFound: string;
  chunkWords: number;
  k: number;
  budgetWords: number;
  expandBelowWords: number;
}

export type NumericPref =
  "chunkWords" | "k" | "budgetWords" | "expandBelowWords";

export interface SettingsResponse {
  settings: Prefs;
  defaults: Prefs;
  /** The full system prompt as the model will receive it. */
  prompt: string;
  levels: { id: Level; label: string; style: string }[];
  ranges: Record<NumericPref, [number, number]>;
  /** Present when the chunk size changed: the new number of fixed chunks. */
  rechunked?: number;
}

/** A retrieval chunk: a whole section, or one fixed-length window of it. */
export interface Chunk {
  id: string;
  docId: string;
  docName: string;
  sectionId: string;
  title: string;
  text: string;
  location: string;
  words: number;
  /** Position of this chunk inside its section (1-based) and how many there are. */
  piece: number;
  pieces: number;
  sectionWords: number;
  pages: [number, number] | null;
  ocr: boolean;
}

export interface Rewrite {
  query: string;
  method: "none" | "model" | "topic question + follow-up";
  followUp: boolean;
  /** What the automatic check concluded, whatever the student chose. */
  detected: boolean;
  carried: string[];
  note: string;
  model?: string;
  ms?: number;
  error?: string | null;
}

export interface RetrievalTrace {
  query: string;
  original: string;
  rewrite: Rewrite;
  chunking: Chunking;
  chunkWords: number | null;
  /** Nothing matched a word; the sections are nearest by meaning only. */
  weak: boolean;
  mode: RetrievalMode;
  requestedMode: RetrievalMode;
  k: number;
  candidates: number;
  totalChunks: number;
  keyword: {
    terms: string[];
    results: { id: string; rank: number; score: number; terms: string[] }[];
    ms: number;
  };
  semantic: {
    available: boolean;
    model: string | null;
    dimensions?: number;
    reason?: string;
    results: { id: string; rank: number; similarity: number }[];
    ms: number;
  };
  fused: {
    constant: number;
    results: {
      id: string;
      rank: number;
      score: number;
      keywordRank: number | null;
      semanticRank: number | null;
    }[];
  };
  selected: string[];
  chunks: Record<string, Chunk>;
  ms: number;
}

/** What the model reads: a chunk, or the whole section it was expanded to. */
export interface ContextItem {
  n: number;
  id: string;
  docId: string;
  docName: string;
  sectionId: string;
  title: string;
  location: string;
  text: string;
  words: number;
  /** Words in the whole section this item belongs to. */
  sectionWords: number;
  expanded: boolean;
  matchedChunkIds: string[];
  contentHash: string;
}

export interface Budget {
  budgetWords: number;
  usedWords: number;
  overBudget: boolean;
  expandBelowWords: number;
  expansion: boolean;
  skipped: { chunkId: string; reason: string }[];
}

/** A sentence from the notes that qualifies the topic, word for word. */
export interface Caveat {
  text: string;
  n: number;
}

export interface PromptTrace {
  messages: {
    role: "system" | "user";
    kind: "instructions" | "context";
    content: string;
  }[];
  earlierQuestions: string[];
  settings: Pick<Prefs, "level" | "instructions" | "notFound">;
  stats: {
    systemChars: number;
    contextChars: number;
    earlierChars: number;
    questionChars: number;
    totalChars: number;
    estimatedTokens: number;
  };
  ms: number;
}

export interface ContextTrace {
  items: ContextItem[];
  budget: Budget;
  chunking: Chunking;
  corpusVersion: string;
  prompt: PromptTrace;
  caveats: Caveat[];
  ms: number;
}

export interface Attempt {
  model: string;
  attempt: number;
  ok: boolean | null;
  reason?: string;
}

export interface GenerationTrace {
  model: string;
  provider: string;
  endpoint: string;
  fallbackModels: string[];
  retries: number;
  parameters: { temperature: number; max_tokens: number; stream: boolean };
  attempts: Attempt[];
  reasoning: string;
  rawAnswer: string;
  usage: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    reasoning_tokens?: number | null;
    total_tokens?: number | null;
  };
  finishReason: string | null;
  timings: {
    firstReasoningMs?: number;
    firstTokenMs?: number;
    totalMs?: number;
  };
  citations: { valid: number[]; invalid: number[] };
  error: string | null;
}

export type TurnStatus =
  | "answered"
  | "not_found"
  | "uncited"
  | "no_passages"
  | "interrupted"
  | "unavailable"
  | "sources_only";

/** Sentences copied from the notes, shown when no model wrote an explanation. */
export interface Extractive {
  kind: "extractive";
  label: string;
  sentences: { text: string; n: number }[];
}

export interface DoneEvent {
  type: "done";
  status: TurnStatus;
  answer: string | null;
  citations: { n: number; id: string }[];
  sources: ContextItem[];
  caveats: Caveat[];
  explanation: Extractive | null;
  conversation: { topic: string[]; followUp: boolean };
  generation: GenerationTrace;
  timings: {
    rewriteMs?: number;
    retrievalMs?: number;
    contextMs?: number;
    generationMs?: number;
    totalMs?: number;
  };
}

export type AskEvent =
  | {
      type: "stage";
      stage: "rewrite" | "retrieval" | "context" | "generation";
    }
  | { type: "retrieval"; trace: RetrievalTrace }
  | { type: "context"; trace: ContextTrace }
  | { type: "generation.attempt"; model: string; attempt: number }
  | { type: "generation.retry"; model: string; attempt: number; reason: string }
  | { type: "reasoning"; delta: string }
  | { type: "token"; delta: string }
  | DoneEvent
  | { type: "error"; error: string };

export type TurnStage =
  | "rewrite"
  | "retrieval"
  | "context"
  | "generation"
  | "done"
  | "error"
  | "stopped";

export interface AskOptions {
  mode: RetrievalMode;
  chunking: Chunking;
  expand: boolean;
}

/** One question and everything the pipeline did to answer it. */
export interface Turn extends AskOptions {
  id: string;
  question: string;
  /** Earlier questions of the topic that were offered with this one. */
  earlier: string[];
  startedAt: number;
  stage: TurnStage;
  retrieval?: RetrievalTrace;
  context?: ContextTrace;
  attempts: Attempt[];
  reasoning: string;
  answer: string;
  done?: DoneEvent;
  error?: string;
}

export interface ContextOptions {
  k: number;
  budgetWords: number;
  expandBelowWords: number;
  chunkWords: number;
}

export interface CompareRun {
  chunking: Chunking;
  chunkWords: number | null;
  mode: RetrievalMode;
  totalChunks: number;
  retrieved: (Chunk & {
    rank: number;
    keywordRank: number | null;
    semanticRank: number | null;
  })[];
  weak: boolean;
  context: ContextItem[];
  budget: Budget;
  caveats: Caveat[];
  /** Sections that reached the context, as "document:section". */
  sections: string[];
  expanded: number;
  ms: number;
}

export interface CompareResult {
  query: string;
  requestedMode: RetrievalMode;
  expand: boolean;
  options: ContextOptions;
  runs: Record<Chunking, CompareRun>;
  agreement: { both: string[]; sectionOnly: string[]; fixedOnly: string[] };
  titles: Record<string, { title: string; docName: string; location: string }>;
  scope: string;
}

interface PracticeItemBase {
  id: string;
  /** Number of the section (in the set's sources) the item was written from. */
  source: number;
  quote: string;
  /** Whether the quote appears in that section word for word. */
  verified: boolean;
}

export interface QuizItem extends PracticeItemBase {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
}

export interface CardItem extends PracticeItemBase {
  front: string;
  back: string;
}

export interface PracticeSource {
  n: number;
  id: string;
  docId: string;
  docName: string;
  sectionId: string;
  title: string;
  location: string;
  text: string;
  words: number;
}

export interface PracticeSummary {
  id: string;
  kind: PracticeKind;
  title: string;
  createdAt: string;
  count: number;
  focus: string;
  documentNames: string[];
  model: string | null;
  verified: number;
  dropped: number;
}

interface PracticeSetBase {
  id: string;
  title: string;
  createdAt: string;
  focus: string;
  level: Level;
  documentIds: string[];
  documentNames: string[];
  model: string | null;
  sources: PracticeSource[];
  dropped: number;
}

export type PracticeSet =
  | (PracticeSetBase & { kind: "quiz"; items: QuizItem[] })
  | (PracticeSetBase & { kind: "flashcards" | "recall"; items: CardItem[] });

export type PracticeStage =
  "selecting" | "thinking" | "writing" | "retrying" | "checking";

export interface PracticeProgress {
  stage: PracticeStage;
  chars?: number;
  reason?: string;
}

export interface PracticeRequest {
  kind: PracticeKind;
  count: number;
  focus: string;
  documentIds?: string[];
}
