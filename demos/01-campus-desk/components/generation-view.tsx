"use client";

import { Brain, Check, Loader2, X } from "lucide-react";
import { Fragment } from "react";
import { useRag } from "./rag-provider";
import {
  formatMs,
  LayerIntro,
  NoTurnYet,
  Stat,
  STATUS_TEXT,
  TurnPicker,
} from "./ui";

/** Show the model's raw text with valid and invalid citation markers marked. */
function RawAnswer({ text, valid }: { text: string; valid: Set<number> }) {
  const parts = text.split(/(\[\d+(?:\s*[,–-]\s*\d+)*\])/g);
  return (
    <pre className="raw">
      {parts.map((part, index) =>
        /^\[\d/.test(part) ? (
          <mark
            key={index}
            data-valid={
              part
                .slice(1, -1)
                .split(/\s*[,–-]\s*/)
                .every((n) => valid.has(Number(n))) || undefined
            }
          >
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </pre>
  );
}

export function GenerationView() {
  const { inspected: turn, health } = useRag();
  if (!turn) return <NoTurnYet layer="generation" />;
  const done = turn.done;
  const trace = done?.generation;
  const working = !["done", "error", "stopped"].includes(turn.stage);
  const usage = trace?.usage ?? {};
  const timings = trace?.timings ?? {};
  const valid = new Set(trace?.citations.valid ?? []);
  const passages = done?.sources ?? [];
  const writingSeconds =
    timings.totalMs != null
      ? (timings.totalMs - (timings.firstReasoningMs ?? 0)) / 1000
      : null;
  const speed =
    usage.completion_tokens && writingSeconds && writingSeconds > 0
      ? Math.round(usage.completion_tokens / writingSeconds)
      : null;

  return (
    <div className="layer">
      <LayerIntro step={3} title="Generation: writing the answer">
        The language model reads the prompt and writes the answer a few
        characters at a time. It was never trained on your document; it can only
        use the passages in its prompt. Every citation it writes is then checked
        against those passages.
      </LayerIntro>
      <TurnPicker />

      <section className="card">
        <p className="card-step">The model</p>
        <div className="stats">
          <Stat
            label="Model"
            value={
              trace?.model ??
              turn.attempts.at(-1)?.model ??
              health?.model ??
              "—"
            }
          />
          <Stat
            label="Provider"
            value={trace?.provider ?? health?.provider ?? "—"}
          />
          <Stat
            label="Temperature"
            value={trace?.parameters.temperature ?? "—"}
            hint="Lower is more focused and repeatable"
          />
          <Stat
            label="Max tokens"
            value={trace?.parameters.max_tokens?.toLocaleString() ?? "—"}
          />
        </div>
        {trace && (
          <p className="fine">
            {trace.endpoint} · streaming · up to {trace.retries} retries per
            model
            {trace.fallbackModels.length
              ? ` · fallbacks: ${trace.fallbackModels.join(", ")}`
              : ""}
          </p>
        )}
      </section>

      <section className="card">
        <p className="card-step">Attempts and timing</p>
        <ol className="attempts">
          {turn.attempts.map((a, index) => (
            <li
              key={index}
              data-ok={a.ok === true || undefined}
              data-failed={a.ok === false || undefined}
            >
              {a.ok === true ? (
                <Check size={13} aria-hidden />
              ) : a.ok === false ? (
                <X size={13} aria-hidden />
              ) : (
                <Loader2 size={13} className="spin" aria-hidden />
              )}
              Attempt {index + 1} · {a.model}
              {a.ok === false && a.reason ? ` · ${a.reason}, retried` : ""}
            </li>
          ))}
          {!turn.attempts.length && (
            <li>
              {working
                ? "Waiting for the prompt…"
                : "The model was not called."}
            </li>
          )}
        </ol>
        <div className="stats">
          <Stat
            label="First thought"
            value={formatMs(timings.firstReasoningMs)}
          />
          <Stat label="First word" value={formatMs(timings.firstTokenMs)} />
          <Stat label="Total" value={formatMs(timings.totalMs)} />
          <Stat label="Speed" value={speed ? `${speed} tok/s` : "—"} />
        </div>
        <div className="stats">
          <Stat
            label="Prompt tokens"
            value={usage.prompt_tokens?.toLocaleString() ?? "—"}
          />
          <Stat
            label="Answer tokens"
            value={usage.completion_tokens?.toLocaleString() ?? "—"}
          />
          <Stat
            label="Reasoning tokens"
            value={usage.reasoning_tokens?.toLocaleString() ?? "—"}
            hint="As reported by the provider; part of the answer tokens"
          />
          <Stat
            label="Finish"
            value={trace?.finishReason ?? (working ? "…" : "—")}
          />
        </div>
      </section>

      {(turn.reasoning || working) && (
        <section className="card">
          <p className="card-step">
            <Brain size={14} aria-hidden /> Reasoning
          </p>
          <p className="fine">
            {trace?.model ?? health?.model} is a reasoning model: it thinks
            before it answers. This text is not shown in the chat answer.
          </p>
          <pre className="reasoning">
            {turn.reasoning || (working ? "…" : "No reasoning was returned.")}
          </pre>
        </section>
      )}

      <section className="card">
        <p className="card-step">What the model wrote</p>
        {trace?.rawAnswer || turn.answer ? (
          <RawAnswer text={trace?.rawAnswer || turn.answer} valid={valid} />
        ) : (
          <p className="muted">
            {working ? "Waiting for the first words…" : "No answer text."}
          </p>
        )}
      </section>

      {done && (
        <section className="card">
          <p className="card-step">Citation check</p>
          <p className="fine">
            The model may only cite passages 1–{passages.length}. Valid
            citations are linked to their passage; any other number is removed
            from the answer.
          </p>
          <table className="table">
            <tbody>
              {[...valid].map((n) => {
                const p = passages.find((s) => s.n === n);
                return (
                  <tr key={n}>
                    <td>
                      <Check size={13} aria-hidden /> [{n}]
                    </td>
                    <td>{p?.title}</td>
                    <td>
                      {p?.docName} · {p?.location}
                    </td>
                  </tr>
                );
              })}
              {trace?.citations.invalid.map((n) => (
                <tr key={`x${n}`} className="invalid">
                  <td>
                    <X size={13} aria-hidden /> [{n}]
                  </td>
                  <td colSpan={2}>Not a passage number, so it was removed.</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!valid.size && !trace?.citations.invalid.length && (
            <p className="muted">No citations in this reply.</p>
          )}
          <p className={`note note-${done.status}`}>
            {STATUS_TEXT[done.status]}
          </p>
          {trace?.error && done.status !== "sources_only" && (
            <p className="error">{trace.error}</p>
          )}
        </section>
      )}
      {turn.stage === "error" && <p className="error">{turn.error}</p>}
    </div>
  );
}
