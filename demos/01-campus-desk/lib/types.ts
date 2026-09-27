export type RetrievalMode = "keyword" | "dense" | "hybrid";

export interface HandbookDocument {
  id: string;
  title: string;
  version: string;
  metadata: Record<string, unknown>;
  sections: { id: string; title: string; text: string; location: string }[];
}

export interface Source {
  id: string;
  documentId: string;
  documentTitle: string;
  title: string;
  text: string;
  location: string;
  section: string;
  version: string;
  contentHash: string;
  citationLabel: string;
}

export interface SearchResult {
  question: string;
  retrievalQuery: string;
  retrievalMode: RetrievalMode;
  mode: "source_search" | "generated";
  status:
    | "sources_found"
    | "generated"
    | "insufficient_evidence"
    | "generation_unavailable"
    | "clarification";
  answer: string | null;
  citations: string[];
  sources: Source[];
  corpusVersion: string;
  notice: string;
  elapsedMs: number;
}

export interface Capabilities {
  generation: boolean;
  modes: RetrievalMode[];
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface Generator {
  /** Honest description of what produces answers, shown next to them. */
  label?: string;
  generate(question: string, sources: Source[]): Promise<unknown>;
}
