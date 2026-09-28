/** Shapes returned by the Python backend (backend/app.py). */

export type RetrievalMode = "hybrid" | "keyword" | "semantic";

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
  retrieval: { modes: RetrievalMode[]; default: RetrievalMode; topK: number };
  limits: { fileBytes: number; documents: number };
}

export interface Overview {
  summary: string;
  topics: string[];
  questions: string[];
  model: string;
}

export interface DocumentSummary {
  id: string;
  name: string;
  format: "pdf" | "word" | "text" | "sections";
  bytes: number;
  addedAt: string;
  pages: number;
  chunks: number;
  characters: number;
  ocrPages: number;
  imageRegions: number;
  ocrFailed: boolean;
  truncated: boolean;
  embeddings: boolean;
  overview: Overview | null;
}

export interface DocumentChunk {
  id: string;
  title: string;
  text: string;
  location: string;
  pages: [number, number] | null;
  chars: number;
  ocr: boolean;
}

export interface DocumentDetail extends Omit<
  DocumentSummary,
  "embeddings" | "chunks"
> {
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
  chunking: {
    target: number | null;
    maximum: number | null;
    minimum: number | null;
    overlap: string;
    count: number;
    averageChars: number;
    minChars: number;
    maxChars: number;
    limit: number;
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
    chunkMs?: number;
    embedMs?: number;
    indexMs?: number;
  };
  chunks: DocumentChunk[];
}

export type UploadStage =
  "reading" | "text" | "ocr" | "chunking" | "embedding" | "indexing";

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

/** Welcome-page content the model wrote from the workspace's documents. */
export interface Profile {
  institution: string;
  unit: string;
  tagline: string;
  welcome: string;
  topics: string[];
  quickActions: { label: string; question: string }[];
  model: string;
}

export interface GuideSettings {
  assistantName: string;
  instructions: string;
  notFound: string;
}

export interface SettingsResponse {
  settings: GuideSettings;
  defaults: GuideSettings;
  /** The full system prompt as the model will receive it. */
  prompt: string;
}

/** A chunk as the retrieval trace carries it. */
export interface Passage extends DocumentChunk {
  docId: string;
  docName: string;
  /** Passage number in the prompt (1-based), on sources sent to the model. */
  n?: number;
}

export interface RetrievalTrace {
  query: string;
  original: string;
  rewrite: {
    query: string;
    method: string;
    model?: string;
    ms?: number;
    error?: string;
  };
  strategy: string;
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
  chunks: Record<string, Passage>;
  ms: number;
}

export interface AugmentationTrace {
  messages: {
    role: "system" | "user" | "assistant";
    kind: "instructions" | "history" | "context";
    content: string;
  }[];
  passages: {
    n: number;
    id: string;
    docName: string;
    title: string;
    location: string;
    chars: number;
  }[];
  settings?: GuideSettings;
  stats: {
    systemChars: number;
    historyChars: number;
    historyMessages: number;
    contextChars: number;
    questionChars: number;
    totalChars: number;
    estimatedTokens: number;
  };
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

export interface DoneEvent {
  type: "done";
  status: TurnStatus;
  answer: string | null;
  citations: { n: number; id: string }[];
  sources: Passage[];
  generation: GenerationTrace;
  timings: {
    rewriteMs?: number;
    retrievalMs?: number;
    augmentationMs?: number;
    generationMs?: number;
    totalMs?: number;
  };
}

export type ChatEvent =
  | {
      type: "stage";
      stage: "rewrite" | "retrieval" | "augmentation" | "generation";
    }
  | { type: "retrieval"; trace: RetrievalTrace }
  | { type: "augmentation"; trace: AugmentationTrace }
  | { type: "generation.attempt"; model: string; attempt: number }
  | { type: "generation.retry"; model: string; attempt: number; reason: string }
  | { type: "reasoning"; delta: string }
  | { type: "token"; delta: string }
  | DoneEvent
  | { type: "error"; error: string };

export type TurnStage =
  | "rewrite"
  | "retrieval"
  | "augmentation"
  | "generation"
  | "done"
  | "error"
  | "stopped";

/** One question and everything the pipeline did to answer it. */
export interface Turn {
  id: string;
  question: string;
  mode: RetrievalMode;
  startedAt: number;
  stage: TurnStage;
  retrieval?: RetrievalTrace;
  augmentation?: AugmentationTrace;
  attempts: Attempt[];
  reasoning: string;
  answer: string;
  done?: DoneEvent;
  error?: string;
}
