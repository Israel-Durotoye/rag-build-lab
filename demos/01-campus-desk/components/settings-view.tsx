"use client";

import { Check, Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { getSettings, saveSettings } from "@/lib/api";
import type { GuideSettings, SettingsResponse } from "@/lib/types";
import { useRag } from "./rag-provider";

const FIELDS: {
  key: keyof GuideSettings;
  label: string;
  hint: string;
  rows?: number;
}[] = [
  {
    key: "assistantName",
    label: "Assistant name",
    hint: "How the assistant refers to itself.",
  },
  {
    key: "instructions",
    label: "Answer style",
    hint: "How answers should read: length, tone, structure, language. One rule per line works best.",
    rows: 9,
  },
  {
    key: "notFound",
    label: "When the answer isn't in the documents",
    hint: "The exact sentence the assistant starts with when the documents don't cover a question.",
    rows: 2,
  },
];

function groundingRules(prompt: string): string {
  const start = prompt.indexOf("Grounding rules");
  const end = prompt.indexOf("Answer style");
  return start >= 0 && end > start ? prompt.slice(start, end).trim() : "";
}

export function SettingsView() {
  const { health } = useRag();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<GuideSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings()
      .then((response) => {
        setData(response);
        setForm(response.settings);
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  const dirty =
    !!data &&
    !!form &&
    FIELDS.some(({ key }) => form[key] !== data.settings[key]);

  const submit = async (next: Partial<GuideSettings>) => {
    setSaving(true);
    setError(null);
    try {
      const response = await saveSettings(next);
      setData(response);
      setForm(response.settings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings">
      <header className="page-head">
        <span className="eyebrow">Settings</span>
        <h1>How the assistant answers</h1>
        <p className="muted">
          These instructions are sent to the assistant with every question. Keep
          them short and specific; the assistant follows them literally.
        </p>
      </header>

      {!data || !form ? (
        <p className="muted">
          {error ? (
            <span className="error">{error}</span>
          ) : (
            <>
              <Loader2 size={14} className="spin" aria-hidden /> Loading…
            </>
          )}
        </p>
      ) : (
        <div className="settings-grid">
          <form
            className="card settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(form);
            }}
          >
            {FIELDS.map(({ key, label, hint, rows }) => (
              <label key={key} className="field">
                <span className="field-label">{label}</span>
                <span className="field-hint">{hint}</span>
                {rows ? (
                  <textarea
                    value={form[key]}
                    rows={rows}
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.value })
                    }
                  />
                ) : (
                  <input
                    value={form[key]}
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.value })
                    }
                  />
                )}
                {form[key] !== data.defaults[key] && (
                  <button
                    type="button"
                    className="link field-reset"
                    onClick={() =>
                      setForm({ ...form, [key]: data.defaults[key] })
                    }
                  >
                    <RotateCcw size={12} aria-hidden /> Use the default
                  </button>
                )}
              </label>
            ))}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="submit"
                className="button"
                disabled={!dirty || saving}
              >
                {saving ? (
                  <Loader2 size={15} className="spin" aria-hidden />
                ) : saved ? (
                  <Check size={15} aria-hidden />
                ) : (
                  <Save size={15} aria-hidden />
                )}
                {saved ? "Saved" : "Save changes"}
              </button>
              <button
                type="button"
                className="button button-outline"
                disabled={saving}
                onClick={() =>
                  void submit({
                    assistantName: "",
                    instructions: "",
                    notFound: "",
                  })
                }
              >
                Reset everything to defaults
              </button>
            </div>
            {!health?.generation && (
              <p className="fine">
                No model key is configured on the server, so these settings
                won&rsquo;t be used until one is added.
              </p>
            )}
          </form>

          <aside className="settings-side">
            <section className="card">
              <h3>
                <ShieldCheck size={16} aria-hidden /> Always applied
              </h3>
              <p className="muted">
                These rules keep answers honest and can&rsquo;t be switched off.
                Your style instructions are added after them.
              </p>
              <pre className="rules">{groundingRules(data.prompt)}</pre>
            </section>
            <section className="card">
              <h3>The full prompt, as saved</h3>
              <p className="muted">
                Exactly what the assistant reads before each question, with the
                library&rsquo;s document names filled in.
              </p>
              <pre className="rules">{data.prompt}</pre>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
