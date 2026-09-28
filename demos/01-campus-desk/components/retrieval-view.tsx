"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import type { RetrievalTrace } from "@/lib/types";
import { useRag } from "./rag-provider";
import {
  formatMs,
  LayerIntro,
  NoTurnYet,
  PassageCard,
  plural,
  Stat,
  TurnPicker,
} from "./ui";

function Row({
  trace,
  id,
  rank,
  selected,
  onPick,
  children,
}: {
  trace: RetrievalTrace;
  id: string;
  rank: number;
  selected: boolean;
  onPick: (id: string) => void;
  children: React.ReactNode;
}) {
  const chunk = trace.chunks[id];
  return (
    <li>
      <button
        type="button"
        className="rank-row"
        data-selected={selected || undefined}
        onClick={() => onPick(id)}
      >
        <span className="rank">{rank}</span>
        <span className="rank-body">
          <strong>{chunk?.title ?? id}</strong>
          <small>
            {chunk?.location}
            {selected && <span className="tag tag-accent">sent to model</span>}
          </small>
          {children}
        </span>
      </button>
    </li>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="bar" aria-hidden>
      <span style={{ width: `${Math.max(2, (value / (max || 1)) * 100)}%` }} />
    </span>
  );
}

export function RetrievalView() {
  const { inspected: turn } = useRag();
  const [picked, setPicked] = useState<string | null>(null);
  if (!turn) return <NoTurnYet layer="retrieval" />;
  const trace = turn.retrieval;

  const intro = (
    <LayerIntro step={1} title="Retrieval: finding the right passages">
      The model can&rsquo;t read the whole document for every question, so
      retrieval picks the few chunks most likely to hold the answer. Two
      searches run side by side: keyword search matches words (with stems, so
      &ldquo;fail&rdquo; finds &ldquo;failed&rdquo;), and semantic search
      matches meaning using the chunk vectors. Their rankings are then fused.
    </LayerIntro>
  );
  if (!trace)
    return (
      <div className="layer">
        {intro}
        <TurnPicker />
        <p className="muted">
          <Loader2 size={14} className="spin" aria-hidden /> Searching…
        </p>
      </div>
    );

  const selected = new Set(trace.selected);
  const maxKeyword = Math.max(...trace.keyword.results.map((r) => r.score), 0);
  const maxFused = Math.max(...trace.fused.results.map((r) => r.score), 0);
  const chosen = picked && trace.chunks[picked] ? picked : null;

  return (
    <div className="layer">
      {intro}
      <TurnPicker />

      <section className="card query">
        <p className="card-step">The question</p>
        <p className="query-text">{trace.original}</p>
        {trace.rewrite.method !== "none" && (
          <p className="rewrite">
            <ArrowRight size={14} aria-hidden />
            <span>
              Searched as: <strong>{trace.query}</strong>
            </span>
            <small>
              {trace.rewrite.method === "model"
                ? `A follow-up, so ${trace.rewrite.model} rewrote it as a standalone question first (${formatMs(trace.rewrite.ms)}).`
                : "A follow-up, so it was searched together with the previous question."}
            </small>
          </p>
        )}
        {trace.strategy !== "search" && (
          <p className="fine">
            A question about the whole document: its opening chunks were added
            to the search results.
          </p>
        )}
        <div className="stats">
          <Stat label="Chunks searched" value={trace.totalChunks} />
          <Stat
            label="Mode"
            value={
              trace.mode === trace.requestedMode
                ? trace.mode
                : `${trace.mode} (fallback)`
            }
          />
          <Stat
            label="Sent to model"
            value={trace.selected.length}
            hint="Top k after fusion"
          />
          <Stat label="Time" value={formatMs(trace.ms)} />
        </div>
      </section>

      <div className="rankings">
        <section className="card">
          <p className="card-step">Keyword search · BM25</p>
          <p className="fine">
            Scores reward rare words that appear often in a chunk. Terms
            searched:{" "}
            {trace.keyword.terms.length
              ? trace.keyword.terms.map((t) => (
                  <code key={t} className="term">
                    {t}
                  </code>
                ))
              : "none (only common words)"}
          </p>
          <ol className="rank-list">
            {trace.keyword.results.slice(0, 10).map((r) => (
              <Row
                key={r.id}
                trace={trace}
                id={r.id}
                rank={r.rank}
                selected={selected.has(r.id)}
                onPick={setPicked}
              >
                <span className="score">
                  <Bar value={r.score} max={maxKeyword} /> {r.score.toFixed(2)}
                </span>
                <span className="matched">matched: {r.terms.join(", ")}</span>
              </Row>
            ))}
          </ol>
          {!trace.keyword.results.length && (
            <p className="muted">No chunk shares a word with the question.</p>
          )}
          <p className="fine">{formatMs(trace.keyword.ms)}</p>
        </section>

        <section className="card">
          <p className="card-step">Semantic search · embeddings</p>
          {trace.semantic.available ? (
            <>
              <p className="fine">
                The question became a vector too ({trace.semantic.model},{" "}
                {trace.semantic.dimensions} numbers). Chunks are ranked by
                cosine similarity: 1.0 means the same meaning.
              </p>
              <ol className="rank-list">
                {trace.semantic.results.slice(0, 10).map((r) => (
                  <Row
                    key={r.id}
                    trace={trace}
                    id={r.id}
                    rank={r.rank}
                    selected={selected.has(r.id)}
                    onPick={setPicked}
                  >
                    <span className="score">
                      <Bar value={r.similarity} max={1} />{" "}
                      {r.similarity.toFixed(3)}
                    </span>
                  </Row>
                ))}
              </ol>
              <p className="fine">{formatMs(trace.semantic.ms)}</p>
            </>
          ) : (
            <p className="muted">
              {trace.requestedMode === "keyword"
                ? "Not used: keyword mode was chosen for this question."
                : trace.semantic.reason}
            </p>
          )}
        </section>

        <section className="card">
          <p className="card-step">
            {trace.mode === "hybrid" ? "Fused ranking · RRF" : "Final ranking"}
          </p>
          <p className="fine">
            {trace.mode === "hybrid"
              ? `Reciprocal rank fusion: each chunk scores 1 / (${trace.fused.constant} + rank) in every list it appears in. The top ${trace.k} go to the model.`
              : `The top ${trace.k} go to the model.`}
          </p>
          <ol className="rank-list">
            {trace.fused.results.slice(0, 10).map((r) => (
              <Row
                key={r.id}
                trace={trace}
                id={r.id}
                rank={r.rank}
                selected={selected.has(r.id)}
                onPick={setPicked}
              >
                <span className="score">
                  <Bar value={r.score} max={maxFused} /> {r.score.toFixed(4)}
                </span>
                <span className="matched">
                  keyword #{r.keywordRank ?? "–"} · semantic #
                  {r.semanticRank ?? "–"}
                </span>
              </Row>
            ))}
          </ol>
        </section>
      </div>

      {chosen && (
        <section className="card">
          <p className="card-step">Chunk you picked</p>
          <PassageCard
            key={chosen}
            passage={trace.chunks[chosen]}
            defaultOpen
          />
        </section>
      )}

      <h3 className="section-title">
        Passed to the augmentation layer ·{" "}
        {plural(trace.selected.length, "passage")}
      </h3>
      <div className="passages">
        {trace.selected.map((id, index) => (
          <PassageCard key={id} passage={trace.chunks[id]} label={index + 1} />
        ))}
      </div>
    </div>
  );
}
