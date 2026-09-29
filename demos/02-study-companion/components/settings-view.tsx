"use client";

import { Check, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { plural } from "@/lib/text";
import type { NumericPref, Prefs } from "@/lib/types";
import { errorMessage, useStudy } from "./study-provider";
import { PageHead } from "./ui";

const NUMBERS: {
  field: NumericPref;
  label: string;
  unit: string;
  help: string;
}[] = [
  {
    field: "k",
    label: "Matches per question",
    unit: "chunks",
    help: "How many chunks retrieval hands on. More gives the model more to read, and more that may be beside the point.",
  },
  {
    field: "budgetWords",
    label: "Context word budget",
    unit: "words",
    help: "The most words the context may hold. Sections are added in rank order until the next one would not fit.",
  },
  {
    field: "expandBelowWords",
    label: "Expand matches below",
    unit: "words",
    help: "A match smaller than this, and only part of its section, grows to the whole section when the budget allows.",
  },
  {
    field: "chunkWords",
    label: "Fixed chunk size",
    unit: "words",
    help: "The length of each fixed-length window. Changing it re-chunks and re-indexes all your notes, which can take a moment.",
  },
];

export function SettingsView() {
  const { settings, savePrefs, health, documents } = useStudy();
  const [edits, setEdits] = useState<Partial<Prefs>>({});
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!settings)
    return (
      <p className="muted">
        {health ? (
          <>
            <Loader2 size={14} className="spin" aria-hidden /> Loading your
            settings…
          </>
        ) : (
          "Settings are kept on the backend, which isn't reachable yet."
        )}
      </p>
    );

  const { ranges, defaults, levels } = settings;
  const saved = settings.settings;
  const form: Prefs = { ...saved, ...edits };
  const dirty = (Object.keys(form) as (keyof Prefs)[]).some(
    (key) => form[key] !== saved[key],
  );
  const invalid = NUMBERS.filter(({ field }) => {
    const value = form[field];
    return (
      !Number.isInteger(value) ||
      value < ranges[field][0] ||
      value > ranges[field][1]
    );
  });
  const rechunks = form.chunkWords !== saved.chunkWords;
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setEdits({ ...edits, [key]: value });
    setState("idle");
    setMessage(null);
  };

  const save = async () => {
    setState("saving");
    setError(null);
    try {
      const reply = await savePrefs(form);
      setEdits({});
      setState("saved");
      setMessage(
        reply.rechunked != null
          ? `Saved. Your notes were re-chunked into ${plural(reply.rechunked, "fixed-length chunk")}.`
          : "Saved.",
      );
    } catch (cause) {
      setState("idle");
      setError(errorMessage(cause, "Your settings could not be saved."));
    }
  };

  return (
    <form
      className="settings"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <PageHead
        eyebrow="Settings"
        title={
          <>
            How you like things <em>explained</em>
          </>
        }
      >
        These are yours alone and are kept with your notes. The grounding rules
        are not settings: the companion always explains from your notes only,
        cites them and keeps their exceptions.
      </PageHead>

      <section className="card">
        <h2 className="card-title">Explanation level</h2>
        <div className="levels">
          {levels.map((level) => (
            <label key={level.id} className="level">
              <input
                type="radio"
                name="level"
                value={level.id}
                checked={form.level === level.id}
                onChange={() => set("level", level.id)}
              />
              <strong>{level.label}</strong>
              <small>
                {level.style.replace(/^- /gm, "").replace(/\n/g, " ")}
              </small>
            </label>
          ))}
        </div>
        <label className="field">
          <span>Anything else the companion should do (optional)</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={form.instructions}
            onChange={(event) => set("instructions", event.target.value)}
            placeholder="e.g. Give formulas in LaTeX. Use British spelling."
          />
        </label>
        <label className="field">
          <span>What it says when your notes don&rsquo;t cover a question</span>
          <input
            maxLength={300}
            value={form.notFound}
            onChange={(event) => set("notFound", event.target.value)}
            placeholder={defaults.notFound}
          />
        </label>
      </section>

      <section className="card">
        <h2 className="card-title">How context is built</h2>
        <div className="number-grid">
          {NUMBERS.map(({ field, label, unit, help }) => (
            <label
              key={field}
              className="field"
              data-invalid={invalid.some((n) => n.field === field) || undefined}
            >
              <span>{label}</span>
              <span className="number">
                <input
                  type="number"
                  inputMode="numeric"
                  min={ranges[field][0]}
                  max={ranges[field][1]}
                  value={Number.isNaN(form[field]) ? "" : form[field]}
                  onChange={(event) => set(field, event.target.valueAsNumber)}
                />
                <em>{unit}</em>
              </span>
              <small>
                {help} {ranges[field][0]}–{ranges[field][1]}; the default is{" "}
                {defaults[field]}.
              </small>
            </label>
          ))}
        </div>
        {rechunks && invalid.length === 0 && (documents?.length ?? 0) > 0 && (
          <p className="note">
            Saving will re-chunk {plural(documents!.length, "set")} of notes
            into {form.chunkWords}-word windows.
          </p>
        )}
      </section>

      <div className="row save-row">
        <button
          type="submit"
          className="button"
          disabled={!dirty || invalid.length > 0 || state === "saving"}
        >
          {state === "saving" ? (
            <Loader2 size={15} className="spin" aria-hidden />
          ) : (
            <Check size={15} aria-hidden />
          )}
          {state === "saving" && rechunks ? "Saving and re-chunking…" : "Save"}
        </button>
        <button
          type="button"
          className="button button-outline"
          disabled={state === "saving"}
          onClick={() => {
            setEdits(defaults);
            setState("idle");
            setMessage(null);
          }}
        >
          <RotateCcw size={14} aria-hidden /> Back to the defaults
        </button>
        {message && (
          <p className="ok" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      <section>
        <h2 className="section-title">The instructions the model receives</h2>
        <p className="fine">
          As saved. Rules 1 to 6 always apply; the style beneath them follows
          your choices above.
        </p>
        <pre className="raw">{settings.prompt}</pre>
      </section>
    </form>
  );
}
