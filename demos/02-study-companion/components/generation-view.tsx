"use client";

import { Check, X } from "lucide-react";
import { formatMs, plural } from "@/lib/text";
import { Markdown } from "./markdown";
import { useStudy } from "./study-provider";
import { LayerIntro, NoTurnYet, Stat, STATUS_TEXT } from "./ui";

export function GenerationView() {
  const { inspected } = useStudy();
  const done = inspected?.done;
  const intro = (
    <LayerIntro step={3} title="Generation">
      The model reads the prompt and writes the explanation. Afterwards every
      citation is checked against the sections it was actually given.
    </LayerIntro>
  );
  if (!inspected || (!done && !inspected.attempts.length))
    return (
      <>
        {intro}
        <NoTurnYet layer="generation" />
      </>
    );
  const generation = done?.generation;
  const attempts = generation?.attempts ?? inspected.attempts;
  const usage = generation?.usage ?? {};

  return (
    <div className="layer">
      {intro}

      {done && (
        <p className={`note note-${done.status}`}>{STATUS_TEXT[done.status]}</p>
      )}

      {generation && (
        <div className="stats stats-wide">
          <Stat
            label="Model"
            value={generation.model}
            hint={generation.endpoint}
          />
          <Stat label="Provider" value={generation.provider} />
          <Stat
            label="First word after"
            value={formatMs(generation.timings.firstTokenMs)}
          />
          <Stat label="Total" value={formatMs(generation.timings.totalMs)} />
          <Stat
            label="Tokens"
            value={usage.total_tokens?.toLocaleString("en") ?? "—"}
            hint={`prompt ${usage.prompt_tokens ?? "—"} · reply ${usage.completion_tokens ?? "—"} · of which thinking ${usage.reasoning_tokens ?? "—"}`}
          />
        </div>
      )}

      {done && !done.answer && (
        <section className="card">
          <h2 className="card-title">No model wrote this explanation</h2>
          <p>{generation?.error}</p>
          {done.explanation && (
            <p className="fine">
              {plural(done.explanation.sentences.length, "sentence")} copied
              from your notes{" "}
              {done.explanation.sentences.length === 1 ? "was" : "were"} shown
              instead. {done.explanation.label}
            </p>
          )}
        </section>
      )}

      {attempts.length > 0 && (
        <section className="card">
          <h2 className="card-title">Attempts</h2>
          <ol className="attempts">
            {attempts.map((attempt, index) => (
              <li key={index} data-ok={attempt.ok ?? "pending"}>
                {attempt.ok ? (
                  <Check size={13} strokeWidth={3} aria-hidden />
                ) : attempt.ok === false ? (
                  <X size={13} strokeWidth={3} aria-hidden />
                ) : (
                  <span className="dot" aria-hidden />
                )}
                <span>
                  {attempt.model} · attempt {attempt.attempt}
                  {attempt.reason ? ` — ${attempt.reason}` : ""}
                  {attempt.ok === null ? " — in progress" : ""}
                </span>
              </li>
            ))}
          </ol>
          {generation && (
            <p className="fine">
              Rate limits, timeouts and empty replies are retried up to{" "}
              {generation.retries} times
              {generation.fallbackModels.length
                ? `, then ${generation.fallbackModels.join(", ")} is tried`
                : ""}
              . Temperature {generation.parameters.temperature}, up to{" "}
              {generation.parameters.max_tokens.toLocaleString("en")} tokens.
            </p>
          )}
        </section>
      )}

      {generation && done?.answer && (
        <section className="card">
          <h2 className="card-title">Citation check</h2>
          <div className="layer-columns">
            <div>
              <p className="ok">
                <Check size={14} aria-hidden />{" "}
                {plural(generation.citations.valid.length, "citation")} point to
                a section the model was given
              </p>
              <ul className="plain">
                {done.citations.map((citation) => {
                  const source = done.sources[citation.n - 1];
                  return (
                    <li key={citation.n}>
                      <span className="ref">{citation.n}</span> {source?.title}{" "}
                      <small className="muted">
                        {source?.docName} · {source?.location}
                      </small>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              {generation.citations.invalid.length ? (
                <p className="error">
                  <X size={14} aria-hidden /> Removed from the answer, because
                  no such section was given:{" "}
                  {generation.citations.invalid.map((n) => `[${n}]`).join(" ")}
                </p>
              ) : (
                <p className="muted">No citation had to be removed.</p>
              )}
              <p className="fine">
                A valid number shows the section was in the prompt. Whether the
                sentence says what the section says is for you to check; the
                section is one click away on the Ask page.
              </p>
            </div>
          </div>
        </section>
      )}

      {(generation?.reasoning || inspected.reasoning) && (
        <details className="prompt">
          <summary>
            The model&rsquo;s thinking
            <small>
              {(
                generation?.reasoning || inspected.reasoning
              ).length.toLocaleString("en")}{" "}
              characters
            </small>
          </summary>
          <pre>{generation?.reasoning || inspected.reasoning}</pre>
        </details>
      )}

      {done?.answer && generation && (
        <div className="layer-columns">
          <section className="card">
            <h2 className="card-title">As the model wrote it</h2>
            <pre className="raw">{generation.rawAnswer}</pre>
          </section>
          <section className="card">
            <h2 className="card-title">As you saw it</h2>
            <div className="answer">
              <Markdown text={done.answer} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
