import { createHash } from "node:crypto";
import type {
  Embedder,
  HandbookDocument,
  RetrievalMode,
  Source,
} from "./types";

const STOP = new Set(
  "a an the is are was were what how when where who why of to in on at for and or it its this that does do can i my me with about".split(
    " ",
  ),
);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(
    (term) => !STOP.has(term),
  );
}

export function ingest(documents: HandbookDocument[]) {
  const sources: Source[] = [];
  const ids = new Set<string>();
  for (const doc of documents) {
    // Campus Desk indexes public handbooks only; tenant-scoped fixtures are rejected.
    if (doc.metadata.tenant != null)
      throw new Error("Tenant documents are not supported in Campus Desk");
    for (const section of doc.sections) {
      const id = `${doc.id}:${section.id}:0`;
      if (ids.has(id)) throw new Error("Duplicate source ID");
      ids.add(id);
      sources.push({
        id,
        documentId: doc.id,
        documentTitle: doc.title,
        title: section.title,
        text: section.text,
        location: section.location,
        section: section.id,
        version: doc.version,
        contentHash: hash(section.text),
        citationLabel: `${doc.id} · ${section.title} · ${section.location} · v${doc.version}`,
      });
    }
  }
  return { sources, version: hash(JSON.stringify(sources)) };
}

export type Corpus = ReturnType<typeof ingest>;

/** BM25 over whole sections. This is a TypeScript keyword index, not SQLite FTS5. */
export function keywordSearch(sources: Source[], question: string): Source[] {
  const terms = [...new Set(tokens(question))].slice(0, 64);
  if (!terms.length || !sources.length) return [];
  const documents = sources.map((source) =>
    tokens(`${source.title} ${source.text}`),
  );
  const averageLength =
    documents.reduce((sum, words) => sum + words.length, 0) /
      documents.length || 1;
  const frequencies = terms.map(
    (term) => documents.filter((words) => words.includes(term)).length,
  );
  return sources
    .map((source, index) => {
      const words = documents[index];
      const score = terms.reduce((sum, term, termIndex) => {
        const tf = words.filter((word) => word === term).length;
        const idf = Math.log(
          1 +
            (sources.length - frequencies[termIndex] + 0.5) /
              (frequencies[termIndex] + 0.5),
        );
        return (
          sum +
          (idf * tf * 2.2) /
            (tf + 1.2 * (0.25 + (0.75 * words.length) / averageLength))
        );
      }, 0);
      return { source, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
    .map(({ source }) => source);
}

export function cosine(a: number[], b: number[]): number {
  if (
    !a.length ||
    a.length !== b.length ||
    ![...a, ...b].every(Number.isFinite)
  ) {
    throw new Error("Invalid embedding vectors");
  }
  const norm = Math.sqrt(
    a.reduce((sum, value) => sum + value * value, 0) *
      b.reduce((sum, value) => sum + value * value, 0),
  );
  return norm ? a.reduce((sum, value, i) => sum + value * b[i], 0) / norm : 0;
}

export function fuse(rankings: Source[][]): Source[] {
  const scores = new Map<string, { source: Source; score: number }>();
  for (const ranking of rankings) {
    const seen = new Set<string>();
    let rank = 0;
    for (const source of ranking) {
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      const prior = scores.get(source.id)?.score ?? 0;
      scores.set(source.id, { source, score: prior + 1 / (60 + ++rank) });
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
    .map(({ source }) => source);
}

export async function search(
  corpus: Corpus,
  question: string,
  mode: RetrievalMode = "keyword",
  embedder?: Embedder,
): Promise<Source[]> {
  const keyword = keywordSearch(corpus.sources, question);
  if (mode === "keyword") return keyword.slice(0, 4);
  if (!embedder) throw new Error("Semantic retrieval is not configured");
  const vectors = await embedder.embed([
    question,
    ...corpus.sources.map((source) => `${source.title}\n${source.text}`),
  ]);
  if (vectors.length !== corpus.sources.length + 1)
    throw new Error("Embedding count mismatch");
  const dense = corpus.sources
    .map((source, index) => ({
      source,
      score: cosine(vectors[0], vectors[index + 1]),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
    .map(({ source }) => source);
  return (mode === "dense" ? dense : fuse([keyword, dense])).slice(0, 4);
}
