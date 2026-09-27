import { search, type Corpus } from "./retrieval";
import type {
  Embedder,
  Generator,
  RetrievalMode,
  SearchResult,
  Source,
} from "./types";

export function validateGeneration(raw: unknown, sources: Source[]) {
  if (!raw || typeof raw !== "object")
    throw new Error("Invalid model response");
  const value = raw as Record<string, unknown>;
  if (
    typeof value.answer !== "string" ||
    typeof value.insufficient !== "boolean" ||
    !Array.isArray(value.citations)
  ) {
    throw new Error("Invalid model schema");
  }
  const allowed = new Set(sources.map((source) => source.id));
  if (!value.citations.every((id) => typeof id === "string" && allowed.has(id)))
    throw new Error("Unknown source ID");
  if (!value.insufficient && (!value.answer.trim() || !value.citations.length))
    throw new Error("Missing answer or citations");
  return {
    answer: value.answer,
    insufficient: value.insufficient,
    citations: [...new Set(value.citations as string[])],
  };
}

export async function answer(
  question: string,
  sources: Source[],
  generator?: Generator,
): Promise<
  Pick<SearchResult, "mode" | "status" | "answer" | "citations" | "notice">
> {
  const base = { mode: "source_search" as const, answer: null, citations: [] };
  if (!sources.length)
    return {
      ...base,
      status: "insufficient_evidence",
      notice:
        "The handbook has no matching passages for this question. Try another topic or browse the sections.",
    };
  if (!generator)
    return {
      ...base,
      status: "sources_found",
      notice:
        "These are passages from the handbook, not an AI-generated answer. Check whether they support your question.",
    };
  try {
    const result = validateGeneration(
      await generator.generate(question, sources),
      sources,
    );
    if (result.insufficient)
      return {
        ...base,
        status: "insufficient_evidence",
        notice:
          "The model reported that the selected passages do not provide enough evidence to answer.",
      };
    return {
      mode: "generated",
      status: "generated",
      answer: result.answer,
      citations: result.citations,
      notice:
        "Citation IDs checked. Review each claim against the original passage.",
    };
  } catch {
    return {
      ...base,
      status: "generation_unavailable",
      notice:
        "The model was unavailable or its answer failed citation validation. You can still read the selected passages.",
    };
  }
}

export async function ask(
  corpus: Corpus,
  question: string,
  options: {
    mode?: RetrievalMode;
    previousQuestion?: string;
    embedder?: Embedder;
    generator?: Generator;
  } = {},
): Promise<SearchResult> {
  question = question.trim();
  if (!question || question.length > 4000)
    throw new Error("Question must contain 1–4000 characters");
  const mode = options.mode ?? "keyword";
  if (!["keyword", "dense", "hybrid"].includes(mode))
    throw new Error("Invalid retrieval mode");
  const start = performance.now();
  let query = question;
  const base = {
    question,
    retrievalQuery: query,
    retrievalMode: mode,
    corpusVersion: corpus.version,
  };
  if (/^(what about|and |how about|why is that)/i.test(question)) {
    if (!options.previousQuestion?.trim())
      return {
        ...base,
        mode: "source_search",
        status: "clarification",
        answer: null,
        citations: [],
        sources: [],
        notice: "Name the topic or ask an initial question before a follow-up.",
        elapsedMs: 0,
      };
    query = `${options.previousQuestion}\nFollow-up: ${question}`;
  }
  const sources = await search(corpus, query, mode, options.embedder);
  const response = await answer(query, sources, options.generator);
  return {
    ...base,
    ...response,
    retrievalQuery: query,
    sources,
    elapsedMs: Math.round((performance.now() - start) * 10) / 10,
  };
}
