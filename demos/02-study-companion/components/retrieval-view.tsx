"use client";

import { AlertTriangle, CornerDownRight } from "lucide-react";
import { formatMs, plural } from "@/lib/text";
import type { Chunk, RetrievalTrace } from "@/lib/types";
import { useStudy } from "./study-provider";
import { CHUNKING_LABEL, LabLink, LayerIntro, NoTurnYet, Stat } from "./ui";

function ChunkName({ chunk }: { chunk: Chunk | undefined }) {
  if (!chunk) return <span className="muted">unknown chunk</span>;
  return (
    <span className="source-title">
      <strong>{chunk.title}</strong>
      <small>
        {chunk.docName} · {chunk.location}
        {chunk.pieces > 1 ? ` · window ${chunk.piece} of ${chunk.pieces}` : ""}
        {" · "}
        {plural(chunk.words, "word")}
      </small>
    </span>
  );
}

function Query({ trace }: { trace: RetrievalTrace }) {
  const { rewrite } = trace;
  return (
    <section className="card">
      <h2 className="card-title">The query</h2>
      <dl className="facts">
        <dt>You asked</dt>
        <dd>{trace.original}</dd>
        {rewrite.followUp && (
          <>
            <dt>Carried over</dt>
            <dd>
              <ul className="plain">
                {rewrite.carried.map((question) => (
                  <li key={question}>
                    <CornerDownRight size={13} aria-hidden /> {question}
                  </li>
                ))}
              </ul>
            </dd>
            <dt>Searched for</dt>
            <dd>
              <code className="block">{trace.query}</code>
            </dd>
            <dt>Written by</dt>
            <dd>
              {rewrite.method === "model"
                ? `${rewrite.model} (${formatMs(rewrite.ms)})`
                : "The topic's first question joined to the follow-up, with no model"}
              {rewrite.error
                ? ` — the model could not rewrite it: ${rewrite.error}`
                : ""}
            </dd>
          </>
        )}
      </dl>
      <p className="fine">
        {rewrite.followUp
          ? rewrite.note
          : rewrite.detected
            ? "This looked like a follow-up, but it was asked as a new topic, so it was searched as written."
            : "Searched as written: it was not a follow-up."}
      </p>
    </section>
  );
}

export function RetrievalView() {
  const { inspected } = useStudy();
  const trace = inspected?.retrieval;
  if (!inspected || !trace)
    return (
      <>
        <LayerIntro step={1} title="Retrieval">
          Finding the chunks of your notes most likely to answer the question.
        </LayerIntro>
        <NoTurnYet layer="retrieval" />
      </>
    );
  const selected = new Set(trace.selected);
  const fallback = trace.mode !== trace.requestedMode;

  return (
    <div className="layer">
      <LayerIntro step={1} title="Retrieval">
        Finding the chunks of your notes most likely to answer the question.
        Nothing here involves the model that writes the explanation.
      </LayerIntro>

      <div className="stats stats-wide">
        <Stat
          label="Chunking"
          value={CHUNKING_LABEL[trace.chunking]}
          hint={
            trace.chunkWords
              ? `${trace.chunkWords}-word windows`
              : "One chunk per section"
          }
        />
        <Stat label="Chunks searched" value={trace.totalChunks} />
        <Stat label="Search" value={trace.mode} />
        <Stat
          label="Selected"
          value={`${trace.selected.length} of ${trace.k}`}
        />
        <Stat label="Time" value={formatMs(trace.ms)} />
      </div>
      {fallback && (
        <p className="note">
          <AlertTriangle size={14} aria-hidden /> You asked for{" "}
          {trace.requestedMode} search, but keyword search was used:{" "}
          {trace.semantic.reason}
        </p>
      )}
      {trace.weak && (
        <p className="note">
          <AlertTriangle size={14} aria-hidden /> No chunk contains any word of
          the query. What was selected is only the nearest in meaning, and may
          be unrelated.
        </p>
      )}

      <Query trace={trace} />

      <div className="layer-columns">
        <section className="card">
          <h2 className="card-title">
            By keyword <small>{formatMs(trace.keyword.ms)}</small>
          </h2>
          <p className="fine">
            Words searched, after dropping common ones. Word endings are
            ignored, so “fail” matches “failed”. Ranked by BM25: rarer words and
            shorter chunks score higher.
          </p>
          <div className="chips">
            {trace.keyword.terms.map((term) => (
              <span key={term} className="chip">
                {term}
              </span>
            ))}
          </div>
          {trace.keyword.results.length ? (
            <ol className="rank-list">
              {trace.keyword.results.map((hit) => (
                <li
                  key={hit.id}
                  data-selected={selected.has(hit.id) || undefined}
                >
                  <span className="rank">{hit.rank}</span>
                  <ChunkName chunk={trace.chunks[hit.id]} />
                  <span className="score" title="BM25 score">
                    {hit.score.toFixed(2)}
                    <small>{hit.terms.join(", ")}</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No chunk contains any of these words.</p>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">
            By meaning <small>{formatMs(trace.semantic.ms)}</small>
          </h2>
          {trace.semantic.available ? (
            <>
              <p className="fine">
                {trace.semantic.model} turned the query into{" "}
                {trace.semantic.dimensions} numbers and compared them with every
                chunk&rsquo;s. 1.00 would be identical in meaning.
              </p>
              <ol className="rank-list">
                {trace.semantic.results.map((hit) => (
                  <li
                    key={hit.id}
                    data-selected={selected.has(hit.id) || undefined}
                  >
                    <span className="rank">{hit.rank}</span>
                    <ChunkName chunk={trace.chunks[hit.id]} />
                    <span className="score" title="Cosine similarity">
                      {hit.similarity.toFixed(3)}
                      <span className="bar" aria-hidden>
                        <i
                          style={{
                            width: `${Math.max(0, Math.min(1, hit.similarity)) * 100}%`,
                          }}
                        />
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">
              {trace.requestedMode === "keyword"
                ? "Not used: this question was searched by keywords only."
                : (trace.semantic.reason ??
                  "Semantic search was not available.")}
            </p>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">Fused, and the top {trace.k} selected</h2>
        <p className="fine">
          {trace.mode === "hybrid"
            ? `Reciprocal rank fusion: each chunk scores 1 / (${trace.fused.constant} + rank) in every ranking it appears in, and the scores are added. A chunk ranked well by both beats one ranked first by only one.`
            : `Only one ranking was used, so its order stands.`}
        </p>
        <div className="table-wrap">
          <table className="set-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Chunk</th>
                <th scope="col">Keyword rank</th>
                <th scope="col">Meaning rank</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {trace.fused.results.map((row) => (
                <tr
                  key={row.id}
                  data-selected={selected.has(row.id) || undefined}
                >
                  <td>
                    <span className="rank">{row.rank}</span>
                  </td>
                  <th scope="row">
                    <ChunkName chunk={trace.chunks[row.id]} />
                  </th>
                  <td>{row.keywordRank ?? "—"}</td>
                  <td>{row.semanticRank ?? "—"}</td>
                  <td>{row.score.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!trace.fused.results.length && (
          <p className="muted">Nothing was found, so nothing was selected.</p>
        )}
        <p className="fine">
          <LabLink question={trace.query} />
        </p>
      </section>
    </div>
  );
}
