/**
 * Payloads exchanged with the Python backend (backend/app.py), contract
 * version 1 (lib/contract.ts). Field names match the backend exactly.
 */

export type RetrievalMode = "hybrid" | "keyword" | "semantic";
export type AnswerStyle = "brief" | "standard" | "steps";
export type ThemePref = "dark" | "light" | "system";
/** How a code was recognised: LED flash patterns, letter+number codes, hex. */
export type CodeScheme = "flash" | "prefixed" | "hex" | (string & {});
export type UnitKind = "paragraph" | "list" | "item" | "row" | "note" | "code";
export type QueryKind = "exact_code" | "paraphrase" | "mixed" | "ambiguity";

export interface Health {
  status: "ok";
  apiVersion: number;
  name: string;
  generation: boolean;
  model: string;
  provider: string;
  fallbackModels: string[];
  embeddings: {
    status: "off" | "loading" | "ready" | "failed";
    model: string;
  };
  ocr: { engine: string; enabled: boolean };
  retrieval: {
    modes: RetrievalMode[];
    default: RetrievalMode;
    rrfConstant: number;
    tieBreak: string;
    candidates: number;
  };
  limits: { fileBytes: number; documents: number };
}

// ---------------------------------------------------------------- models

export interface Revision {
  id: string;
  label: string;
  aliases: string[];
}

export interface ModelDef {
  id: string;
  name: string;
  /** A compact label, e.g. "3B+". */
  short: string;
  family: string | null;
  aliases: string[];
  revisions: Revision[];
}

export interface FamilyDef {
  id: string;
  name: string;
  aliases: string[];
  members: string[];
}

export interface LibraryModel extends ModelDef {
  /** IDs of the documents that cover this model. */
  documents: string[];
  /** Passages that apply to it (its own and shared ones). */
  units: number;
  codes: number;
}

export interface ModelRef {
  id: string;
  name: string;
  short: string;
}

export interface RevisionRef {
  id: string;
  label: string;
}

/** What the picker has chosen, persisted per browser. */
export interface Selection {
  model: string | null;
  revision: string | null;
}

// ---------------------------------------------------------------- library

export interface SourceInfo {
  publisher: string;
  /** The page a reader would open. */
  url: string;
  /** The exact file the text was taken from (pinned to a commit when known). */
  source: string;
  licence: string;
  licenceUrl: string;
  retrieved: string;
}

export type DocumentFormat = "sample" | "pdf" | "word" | "text";

export interface DocumentSummary {
  id: string;
  name: string;
  format: DocumentFormat;
  version: string;
  addedAt: string;
  bytes: number;
  pages: number;
  sections: number;
  units: number;
  words: number;
  codes: number;
  /** Model IDs this document covers. */
  models: string[];
  /** False until someone confirms the models found in an upload. */
  modelsConfirmed: boolean;
  source: SourceInfo | null;
  sample: boolean;
  ocrPages: number;
  truncated: boolean;
  embeddings: boolean;
}

export interface SampleInfo {
  available: boolean;
  loaded: boolean;
  documents: { id: string; title: string; units: number }[];
  publisher: string;
  licence: string;
  licenceUrl: string;
  queries: number;
}

export interface Library {
  documents: DocumentSummary[];
  models: LibraryModel[];
  families: FamilyDef[];
  sample: SampleInfo;
  corpusVersion: string;
}

export interface Unit {
  id: string;
  chunkId: string;
  sectionId: string;
  text: string;
  location: string;
  kind: UnitKind;
  /** Models this passage applies to; null means every model of the document. */
  models: string[] | null;
  revisions: Record<string, string[]>;
  codes: string[];
  /** For a table row, the table's header row. */
  header: string | null;
  pages: [number, number] | null;
  words: number;
  /** How its models were decided: its own text, its table's header, a heading, the document, or an override. */
  tag: "text" | "header" | "heading" | "document" | "override" | null;
  tagReason: string | null;
}

export interface Section {
  id: string;
  title: string;
  path: string[];
  location: string;
  unitIds: string[];
}

export interface CodeEntry {
  code: string;
  display: string;
  scheme: CodeScheme;
  unitId: string;
  chunkId: string;
  models: string[] | null;
  meaning: string;
}

/** The section and unit counts of the summary are replaced by the lists themselves. */
export interface DocumentDetail extends Omit<
  DocumentSummary,
  "sections" | "units"
> {
  sections: Section[];
  units: Unit[];
  codeEntries: CodeEntry[];
  modelDefs: ModelDef[];
  families: FamilyDef[];
  /** Model-like names found in an upload, for confirming its models. */
  suggestedModels: { name: string; count: number }[];
  extraction: {
    pageCount: number;
    ocrPages: number;
    characters: number;
    ocrEngine: string | null;
  } | null;
}

export type UploadStage =
  | "reading"
  | "text"
  | "ocr"
  | "sectioning"
  | "tagging"
  | "embedding"
  | "indexing";

export interface UploadProgress {
  fileName: string;
  stage: UploadStage;
  done?: number;
  total?: number;
  index?: number;
  count?: number;
}

// ---------------------------------------------------------------- asking

export type ClarifyReason =
  "no_model" | "ambiguous_name" | "conflict" | "revision";

export interface Candidate {
  id: string;
  name: string;
  short: string;
  family: string | null;
  /** Its manual has passages that match the question. */
  matched: boolean;
  kind: "model" | "revision";
  /** For a revision, the model it belongs to. */
  modelId?: string;
}

export interface Clarification {
  reason: ClarifyReason;
  message: string;
  question: string;
  candidates: Candidate[];
}

export interface CodeMention {
  raw: string;
  code: string;
  display: string;
  scheme: CodeScheme;
  start: number;
  end: number;
  /** The library has this code somewhere. */
  known: boolean;
}

export interface Mention {
  alias: string;
  kind: "model" | "family" | "revision";
  models: string[];
  revision: string | null;
  start: number;
  end: number;
}

export interface IdentifyTrace {
  question: string;
  /** What retrieval searched for after codes were read. */
  query: string;
  codes: CodeMention[];
  readAs: string[];
  mentions: Mention[];
  picker: Selection;
  chosen: {
    model: string | null;
    revision: string | null;
    source: "question" | "picker" | "none";
  };
  /** How a follow-up was turned into the query that was searched. */
  rewrite: Rewrite;
  ms: number;
}

export interface Rewrite {
  query: string;
  method: string;
  followUp: boolean;
  detected: boolean;
  /** Earlier questions carried into the search (never earlier answers). */
  carried: string[];
  note: string;
  model?: string;
  error?: string | null;
  ms?: number;
}

export type FaultCard =
  | {
      kind: "found";
      code: string;
      display: string;
      scheme: CodeScheme;
      model: ModelRef;
      revision: RevisionRef | null;
      meaning: string;
      header: string | null;
      unitId: string;
      chunkId: string;
      location: string;
      docId: string;
      docName: string;
      /** From an upload whose models aren't confirmed: it counts for every model. */
      unconfirmed: boolean;
      /** Models whose manuals give this code the same meaning. */
      sameIn: ModelRef[];
      /** Models whose manuals give this code another meaning. */
      differsIn: ModelRef[];
    }
  | {
      kind: "not_found";
      code: string;
      display: string;
      scheme: CodeScheme;
      model: ModelRef;
      revision: RevisionRef | null;
      didYouMean: { code: string; display: string }[];
      /** Models whose manuals do have this code. */
      elsewhere: ModelRef[];
    };

export interface ChunkInfo {
  id: string;
  docId: string;
  docName: string;
  unitId: string;
  sectionId: string;
  title: string;
  path: string[];
  text: string;
  location: string;
  kind: UnitKind;
  models: string[] | null;
  revisions: Record<string, string[]>;
  header: string | null;
}

export interface KeywordResult {
  id: string;
  rank: number;
  score: number;
  terms: string[];
}

export interface SemanticResult {
  id: string;
  rank: number;
  similarity: number;
}

export interface FusedResult {
  id: string;
  rank: number;
  score: number;
  keywordRank: number | null;
  semanticRank: number | null;
  tied?: boolean;
}

export interface FilterInfo {
  model: string | null;
  revision: string | null;
  allowed: number;
  excluded: number;
}

export interface RetrievalTrace {
  query: string;
  mode: RetrievalMode;
  requestedMode: RetrievalMode;
  k: number;
  candidates: number;
  totalChunks: number;
  keyword: { terms: string[]; results: KeywordResult[]; ms: number };
  semantic: {
    available: boolean;
    model: string | null;
    results: SemanticResult[];
    ms: number;
    reason?: string;
    dimensions?: number;
  };
  fused: { constant: number; tieBreak: string; results: FusedResult[] };
  selected: string[];
  chunks: Record<string, ChunkInfo>;
  filter: FilterInfo;
  /** Nothing matched a word of the question; semantic search still returns its nearest passages. */
  weak: boolean;
  ms: number;
}

export interface ContextUnit {
  id: string;
  chunkId: string;
  text: string;
  matched: boolean;
  /** Belongs to another model or revision: shown greyed, never sent to the model. */
  masked: boolean;
  models: string[] | null;
  revisions: Record<string, string[]>;
  kind: UnitKind;
  header: string | null;
}

export interface ContextItem {
  n: number;
  id: string;
  docId: string;
  docName: string;
  sectionId: string;
  title: string;
  path: string[];
  location: string;
  /** Exactly what the model read for this passage. */
  text: string;
  words: number;
  units: ContextUnit[];
  /** The exact code match, placed first by lookup rather than by ranking. */
  pinned: boolean;
  matchedChunkIds: string[];
  /** The section was longer than the budget, so only part of it is here. */
  partial: boolean;
  source: SourceInfo | null;
  /** From an upload whose models aren't confirmed: it counts for every model. */
  unconfirmed: boolean;
}

export interface SafetyNote {
  text: string;
  n: number;
  /** The revisions the sentence is limited to ("v1.2"), when it is. */
  only: string | null;
}

export interface PromptTrace {
  messages: { role: "system" | "user"; kind: string; content: string }[];
  earlierQuestions: string[];
  settings: { style: AnswerStyle; instructions: string; notFound: string };
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
  budget: {
    budgetWords: number;
    usedWords: number;
    skipped: { chunkId: string; reason: string }[];
  };
  masked: number;
  safetyNotes: SafetyNote[];
  prompt: PromptTrace | null;
  ms: number;
}

export interface ExcludedItem {
  id: string;
  docName: string;
  title: string;
  text: string;
  location: string;
  models: ModelRef[];
  rank: number;
}

export interface Excluded {
  count: number;
  items: ExcludedItem[];
}

export interface Attempt {
  model: string;
  attempt: number;
  ok: boolean | null;
  reason?: string;
}

export interface Generation {
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

export type AnswerStatus =
  | "answered"
  | "uncited"
  | "not_found"
  | "interrupted"
  | "unavailable"
  | "sources_only"
  | "no_passages"
  | "clarification";

export interface Explanation {
  kind: "extractive";
  label: string;
  /** Verbatim, each with the revisions it is limited to ("v1.2"), if any. */
  sentences: { text: string; n: number; only: string | null }[];
}

export interface Done {
  type: "done";
  status: AnswerStatus;
  answer: string | null;
  citations: { n: number; id: string }[];
  sources: ContextItem[];
  safetyNotes: SafetyNote[];
  card: FaultCard | null;
  model: ModelRef | null;
  revision: RevisionRef | null;
  readAs: string[];
  explanation: Explanation | null;
  generation: Generation | null;
  excluded: Excluded | null;
  clarification: Clarification | null;
  conversation: { topic: string[]; followUp: boolean };
  timings: Record<string, number>;
}

export type Stage = "identify" | "retrieval" | "context" | "generation";

export type AskEvent =
  | { type: "stage"; stage: Stage }
  | { type: "identify"; trace: IdentifyTrace }
  | { type: "clarification"; clarification: Clarification }
  | { type: "card"; card: FaultCard }
  | { type: "retrieval"; trace: RetrievalTrace }
  | { type: "excluded"; excluded: Excluded }
  | { type: "context"; trace: ContextTrace }
  | { type: "generation.attempt"; model: string; attempt: number }
  | { type: "generation.retry"; model: string; attempt: number; reason: string }
  | { type: "reasoning"; delta: string }
  | { type: "token"; delta: string }
  | Done
  | { type: "error"; error: string };

export interface AskRequest {
  message: string;
  model?: string | null;
  revision?: string | null;
  mode?: RetrievalMode;
  k?: number;
  /** Earlier questions of the current topic (chat). Answers are never sent. */
  earlier?: string[];
  followUp?: boolean | "auto";
}

/** One question and everything that came back for it, as the interface keeps it. */
export interface Turn {
  id: string;
  question: string;
  selection: Selection;
  mode: RetrievalMode;
  stage: Stage | null;
  identify: IdentifyTrace | null;
  clarification: Clarification | null;
  card: FaultCard | null;
  retrieval: RetrievalTrace | null;
  excluded: Excluded | null;
  context: ContextTrace | null;
  attempts: Attempt[];
  reasoning: string;
  answer: string;
  done: Done | null;
  error: string | null;
  streaming: boolean;
  startedAt: number;
}

// ---------------------------------------------------------------- lab

export interface LabFused {
  id: string;
  rank: number;
  score: number;
  /** [keyword rank, semantic rank]; null where a retriever did not return it. */
  ranks: [number | null, number | null];
  bestRank: number;
  tied: boolean;
}

export interface LabResult {
  query: string;
  readAs: string[];
  filter: FilterInfo;
  k: number;
  constant: number;
  tieBreak: string;
  keyword: { terms: string[]; results: KeywordResult[] };
  semantic: {
    available: boolean;
    reason?: string;
    model: string | null;
    results: SemanticResult[];
  };
  fused: LabFused[];
  chunks: Record<string, ChunkInfo>;
  /** Expected passages when the query is one of the labelled queries. */
  expected: string[];
  queryId: string | null;
  ms: number;
}

// ---------------------------------------------------------------- evaluation

export interface LabelledQuery {
  id: string;
  query: string;
  kind: QueryKind;
  model: string | null;
  revision: string | null;
  expected: string[];
  expectStatus: "answer" | "clarification";
  expectedCandidates?: string[];
  note: string;
}

export interface EvalModeResult {
  mode: RetrievalMode;
  /** The mode actually used (semantic falls back to keyword without embeddings). */
  used: RetrievalMode;
  ranked: string[];
  hit: boolean;
  rank: number | null;
  /** Passages the tags say are for another model (a check of the filter). */
  wrongModel: number;
  /** Passages labelled by hand as a look-alike board's answer. */
  lookalike: number;
}

export interface EvalRow {
  id: string;
  query: string;
  kind: QueryKind;
  model: string | null;
  revision: string | null;
  expected: string[];
  expectStatus: "answer" | "clarification";
  asked: boolean | null;
  /** Why Finder asked: no_model, ambiguous_name, conflict or revision. */
  reason: ClarifyReason | null;
  candidates: string[];
  /** Candidates whose manuals matched the question. */
  matched: string[];
  candidatesOk: boolean | null;
  modes: Partial<Record<RetrievalMode, EvalModeResult>>;
  /** The exact-code lookup, measured apart from the search modes. */
  lookup: { code: string; chunkId: string; hit: boolean } | null;
  /** Passages labelled by hand as wrong for this question's model. */
  forbidden: string[];
}

export interface EvalRun {
  id: string;
  createdAt: string;
  k: number;
  constant: number;
  embedder: string | null;
  corpusVersion: string;
  rows: EvalRow[];
  totals: Partial<Record<RetrievalMode, { hits: number; of: number }>>;
  lookup: { hits: number; of: number };
  clarification: { asked: number; of: number };
  /** Look-alike passages labelled by hand that reached a top k, per mode
   * (missing from runs saved before it was counted). */
  lookalike?: {
    queries: number;
    found: Partial<Record<RetrievalMode, number>>;
  };
  scope: string;
}

export interface EvalRunSummary {
  id: string;
  createdAt: string;
  k: number;
  constant: number;
  embedder: string | null;
  totals: EvalRun["totals"];
  lookup: EvalRun["lookup"];
  clarification: EvalRun["clarification"];
}

export interface EvaluationInfo {
  queries: LabelledQuery[];
  runs: EvalRunSummary[];
  scope: string;
}

export interface EvalProgress {
  done: number;
  total: number;
  query?: string;
}

// ---------------------------------------------------------------- guide, codes

export interface GuidePassage {
  chunkId: string;
  docName: string;
  title: string;
  text: string;
  location: string;
}

export interface Lookalike {
  model: ModelRef;
  codes: { code: string; display: string; here: string; there: string }[];
  facts: {
    header: string | null;
    title: string;
    here: GuidePassage;
    there: GuidePassage;
  }[];
}

export interface ModelGuide {
  model: LibraryModel;
  family: FamilyDef | null;
  documents: { id: string; name: string; source: SourceInfo | null }[];
  identification: GuidePassage[];
  lookalikes: Lookalike[];
}

export interface CodeCell {
  meaning: string;
  chunkId: string;
  display: string;
  /** The table's header line when the meaning is a table row. */
  header: string | null;
}

export interface CodeRow {
  code: string;
  display: string;
  scheme: CodeScheme;
  differs: boolean;
  cells: Record<string, CodeCell | null>;
}

export interface CodesMatrix {
  models: (ModelRef & { family: string | null })[];
  rows: CodeRow[];
  counts: { codes: number; differing: number };
}

export interface CodeSuggestion {
  code: string;
  display: string;
  scheme: CodeScheme;
  models: string[];
  meaning: string;
}

// ---------------------------------------------------------------- settings

export interface Prefs {
  style: AnswerStyle;
  instructions: string;
  notFound: string;
  mode: RetrievalMode;
  k: number;
  rrfConstant: number;
  budgetWords: number;
}

export type RangedPref = "k" | "rrfConstant" | "budgetWords";

export interface SettingsResponse {
  settings: Prefs;
  defaults: Prefs;
  ranges: Record<RangedPref, [number, number]>;
  styles: { id: AnswerStyle; label: string; style: string }[];
  /** The system prompt as it is sent, with the current settings. */
  prompt: string;
  rules: string;
  policy: { alwaysAsk: true; text: string };
}
