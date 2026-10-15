"use client";

import {
  Check,
  LoaderCircle,
  Lock,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { getSettings } from "@/lib/api";
import { shortcutsStore } from "@/lib/shortcuts";
import { applyTheme, isThemePref, readThemePref } from "@/lib/theme";
import { plural } from "@/lib/text";
import type {
  Health,
  Prefs,
  RangedPref,
  RetrievalMode,
  SettingsResponse,
  ThemePref,
} from "@/lib/types";
import { errorMessage, useFinder } from "./finder-provider";
import { Alert, PageHead, Spinner } from "./ui";
import styles from "./settings-view.module.css";

/**
 * Settings: how answers are written and how passages are found (kept per
 * workspace by the backend, GET/PUT /api/settings), the theme (kept in this
 * browser), and what is fixed: the model policy, the grounding rules and the
 * system prompt exactly as it is sent.
 */

const FIELDS: (keyof Prefs)[] = [
  "style",
  "instructions",
  "notFound",
  "mode",
  "k",
  "rrfConstant",
  "budgetWords",
];
const RANGED: RangedPref[] = ["k", "rrfConstant", "budgetWords"];
/** The backend's limits (backend/preferences.py, TEXT_LIMITS). */
const MAX_INSTRUCTIONS = 2000;
const MAX_NOT_FOUND = 300;

const MODES: { id: RetrievalMode; label: string; help: string }[] = [
  {
    id: "hybrid",
    label: "Hybrid",
    help: "Keyword and semantic rankings, fused by reciprocal rank fusion (RRF).",
  },
  {
    id: "keyword",
    label: "Keyword",
    help: "The question's words, ranked by BM25.",
  },
  {
    id: "semantic",
    label: "Semantic",
    help: "The passages closest in meaning, by embedding similarity.",
  },
];

const THEMES: { id: ThemePref; label: string; Icon: LucideIcon }[] = [
  { id: "dark", label: "Low light", Icon: Moon },
  { id: "light", label: "Light", Icon: Sun },
  { id: "system", label: "Match system", Icon: Monitor },
];

interface Notice {
  tone: "ok" | "bad";
  text: string;
  /** What "Undo" puts back after the defaults were restored. */
  undo?: Prefs;
}

function inRange(value: number, [low, high]: [number, number]): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}

/** Why a search mode can't run on this server, from its reported capabilities. */
function unavailableModes(
  health: Health | null,
): Partial<Record<RetrievalMode, string>> {
  if (!health) return {};
  const reasons: Partial<Record<RetrievalMode, string>> = {};
  for (const { id } of MODES)
    if (!health.retrieval.modes.includes(id))
      reasons[id] = "This server doesn't offer it.";
  const semantic =
    health.embeddings.status === "off"
      ? "Semantic search is off on this server."
      : health.embeddings.status === "failed"
        ? "The embedding model failed to load on this server."
        : null;
  if (semantic) {
    reasons.hybrid ??= semantic;
    reasons.semantic ??= semantic;
  }
  return reasons;
}

/** A style's instructions ("- …" lines) as plain lines. */
function styleLines(style: string): string[] {
  return style
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function listWords(words: string[]): string {
  return words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// ---------------------------------------------------------------- theme

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-pref"],
  });
  return () => observer.disconnect();
}

/** The preference the page is showing: set before paint, and by applyTheme. */
function themeSnapshot(): ThemePref {
  const shown = document.documentElement.getAttribute("data-theme-pref");
  return isThemePref(shown) ? shown : readThemePref();
}

function themeOnServer(): ThemePref | null {
  return null;
}

function Appearance() {
  const theme = useSyncExternalStore<ThemePref | null>(
    subscribeTheme,
    themeSnapshot,
    themeOnServer,
  );
  const shortcuts = useSyncExternalStore(
    shortcutsStore.subscribe,
    shortcutsStore.get,
    shortcutsStore.getServer,
  );
  return (
    <section
      className={`panel ${styles.section}`}
      aria-labelledby="settings-appearance"
    >
      <div className={styles.head}>
        <h2 id="settings-appearance">Appearance</h2>
        <p className="muted small">
          Kept in this browser and applied straight away.
        </p>
      </div>
      <div className={`seg ${styles.fullSeg}`} role="group" aria-label="Theme">
        {THEMES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={styles.segButton}
            aria-pressed={theme === id}
            onClick={() => applyTheme(id)}
          >
            <Icon size={15} className={styles.segIcon} aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <p className="hint">
        Low light is the default. Match system follows your device&rsquo;s light
        or dark setting.
      </p>
      <div className={styles.toggleRow}>
        <span id="settings-shortcuts">
          Single-key shortcuts: <kbd>/</kbd> for the search box, <kbd>m</kbd>{" "}
          for the model picker
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={shortcuts}
          aria-labelledby="settings-shortcuts"
          onClick={() => shortcutsStore.set(!shortcuts)}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- numbers

function RangeSetting({
  id,
  label,
  help,
  unit,
  value,
  range,
  defaultValue,
  step = 1,
  exact = false,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  unit: string;
  value: number;
  range: [number, number];
  defaultValue: number;
  step?: number;
  /** Also offer a number field, for ranges too wide to set by dragging. */
  exact?: boolean;
  onChange: (value: number) => void;
}) {
  const [low, high] = range;
  const valid = inRange(value, range);
  const shown = valid ? value : defaultValue;
  const spoken = `${shown.toLocaleString("en")}${unit ? ` ${unit}` : ""}`;
  return (
    <div className={styles.range}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className="label">
          {label}
        </label>
        {exact ? (
          <span className={`field ${styles.number}`}>
            <input
              type="number"
              inputMode="numeric"
              min={low}
              max={high}
              step={1}
              value={Number.isNaN(value) ? "" : value}
              aria-label={`${label}, exact value`}
              aria-invalid={!valid || undefined}
              aria-describedby={`${id}-help`}
              onChange={(event) => onChange(event.target.valueAsNumber)}
            />
          </span>
        ) : (
          <output htmlFor={id} className={styles.value}>
            {spoken}
          </output>
        )}
      </div>
      <input
        id={id}
        type="range"
        className="slider"
        min={low}
        max={high}
        step={step}
        value={shown}
        aria-valuetext={spoken}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      <p id={`${id}-help`} className="hint">
        {help} From {low.toLocaleString("en")} to {high.toLocaleString("en")};
        the default is {defaultValue.toLocaleString("en")}.
      </p>
      {!valid && (
        <p className={styles.invalid}>
          Enter a whole number from {low.toLocaleString("en")} to{" "}
          {high.toLocaleString("en")}.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the form

function PrefsForm({
  settings,
  health,
}: {
  settings: SettingsResponse;
  health: Health | null;
}) {
  const { savePrefs } = useFinder();
  const [edits, setEdits] = useState<Partial<Prefs>>({});
  const [busy, setBusy] = useState<"save" | "reset" | "undo" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const { defaults, ranges } = settings;
  const saved = settings.settings;
  const form: Prefs = { ...saved, ...edits };
  const changed = FIELDS.filter((key) => form[key] !== saved[key]);
  const invalid = RANGED.filter((key) => !inRange(form[key], ranges[key]));
  const atDefaults = FIELDS.every((key) => saved[key] === defaults[key]);
  const style =
    settings.styles.find((s) => s.id === form.style) ?? settings.styles[0];
  const reasons = unavailableModes(health);
  const blocked = MODES.filter((mode) => reasons[mode.id]);
  const semanticOff = Boolean(reasons.hybrid);

  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setEdits((current) => ({ ...current, [key]: value }));
    setNotice(null);
  };

  const run = async (
    kind: "save" | "reset" | "undo",
    patch: Partial<Prefs>,
    done: Notice,
    failed: string,
  ) => {
    setBusy(kind);
    setNotice(null);
    try {
      await savePrefs(patch);
      setEdits({});
      setNotice(done);
    } catch (cause) {
      setNotice({ tone: "bad", text: errorMessage(cause, failed) });
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!changed.length || invalid.length) return;
    const patch = Object.fromEntries(
      changed.map((key) => [key, form[key]]),
    ) as Partial<Prefs>;
    void run(
      "save",
      patch,
      { tone: "ok", text: "Saved. New questions use these settings." },
      "Your settings couldn't be saved. Try again.",
    );
  };

  const reset = () =>
    void run(
      "reset",
      defaults,
      { tone: "ok", text: "Defaults restored.", undo: saved },
      "The defaults couldn't be restored. Try again.",
    );

  const undo = (previous: Prefs) =>
    void run(
      "undo",
      previous,
      { tone: "ok", text: "Your previous settings are back." },
      "Your previous settings couldn't be put back. Try again.",
    );

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="grid-2">
        <section
          className={`panel ${styles.section}`}
          aria-labelledby="settings-answers"
        >
          <div className={styles.head}>
            <h2 id="settings-answers">Answers</h2>
            <p className="muted small">
              How the model writes. The grounding rules come first and are
              fixed; they are shown at the end of this page.
            </p>
          </div>
          {health && !health.generation && (
            <Alert tone="info">
              No model key is configured on this server, so answers quote the
              manual&rsquo;s own sentences. These three settings take effect
              once a key is added.
            </Alert>
          )}

          <div className={styles.group}>
            <span id="settings-style" className="label">
              Answer style
            </span>
            <div
              className={`seg ${styles.fullSeg}`}
              role="group"
              aria-labelledby="settings-style"
            >
              {settings.styles.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.segButton}
                  aria-pressed={form.style === option.id}
                  aria-describedby={`settings-style-${option.id}`}
                  onClick={() => set("style", option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {settings.styles.map((option) => (
              <span key={option.id} id={`settings-style-${option.id}`} hidden>
                {styleLines(option.style).join(" ")}
              </span>
            ))}
            {style && (
              <div className={`well ${styles.styleBox}`}>
                <p className="eyebrow">
                  What &ldquo;{style.label}&rdquo; asks of the model
                </p>
                <ul className={styles.styleLines}>
                  {styleLines(style.style).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className={styles.group}>
            <div className={styles.labelRow}>
              <label htmlFor="settings-instructions" className="label">
                Extra instructions
              </label>
              <span className={styles.counter}>
                {form.instructions.length.toLocaleString("en")} /{" "}
                {MAX_INSTRUCTIONS.toLocaleString("en")}
              </span>
            </div>
            <div className={`field ${styles.area}`}>
              <textarea
                id="settings-instructions"
                rows={4}
                maxLength={MAX_INSTRUCTIONS}
                value={form.instructions}
                aria-describedby="settings-instructions-help"
                onChange={(event) => set("instructions", event.target.value)}
              />
            </div>
            <p id="settings-instructions-help" className="hint">
              Optional. Sent after the answer style, under &ldquo;The reader
              also asks&rdquo;. The grounding rules are sent first, marked
              &ldquo;always apply&rdquo;.
            </p>
          </div>

          <div className={styles.group}>
            <div className={styles.labelRow}>
              <label htmlFor="settings-not-found" className="label">
                When the manual doesn&rsquo;t cover it
              </label>
              <span className={styles.counter}>
                {form.notFound.length} / {MAX_NOT_FOUND}
              </span>
            </div>
            <div className={`field ${styles.area}`}>
              {/* Two rows so the whole sentence shows; it stays one line,
                  as the backend requires, so Enter saves instead. */}
              <textarea
                id="settings-not-found"
                rows={2}
                maxLength={MAX_NOT_FOUND}
                value={form.notFound}
                placeholder={defaults.notFound}
                aria-describedby="settings-not-found-help"
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
                onChange={(event) =>
                  set("notFound", event.target.value.replace(/[\r\n]+/g, " "))
                }
              />
            </div>
            <p id="settings-not-found-help" className="hint">
              The grounding rules tell the model to begin with exactly this
              sentence when the passages don&rsquo;t answer, and Finder then
              marks the answer as not covered. Leave it empty for the default.
            </p>
          </div>
        </section>

        <section
          className={`panel ${styles.section}`}
          aria-labelledby="settings-search"
        >
          <div className={styles.head}>
            <h2 id="settings-search">Search</h2>
            <p className="muted small">
              How passages are found for each question, after the model filter.
            </p>
          </div>

          <div className={styles.group}>
            <span id="settings-mode" className="label">
              Default search mode
            </span>
            <div
              className={`seg ${styles.fullSeg}`}
              role="group"
              aria-labelledby="settings-mode"
            >
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={styles.segButton}
                  aria-pressed={form.mode === mode.id}
                  aria-describedby={`settings-mode-${mode.id}`}
                  disabled={Boolean(reasons[mode.id])}
                  title={reasons[mode.id]}
                  onClick={() => set("mode", mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {MODES.map((mode) => (
              <span key={mode.id} id={`settings-mode-${mode.id}`} hidden>
                {mode.help}
                {reasons[mode.id] ? ` Unavailable: ${reasons[mode.id]}` : ""}
              </span>
            ))}
            <p className="hint">
              {MODES.find((mode) => mode.id === form.mode)?.help}
            </p>
            {blocked.length > 0 && (
              <p className={styles.reason}>
                {listWords(blocked.map((mode) => mode.label))}{" "}
                {blocked.length === 1 ? "is" : "are"} unavailable:{" "}
                {[...new Set(blocked.map((mode) => reasons[mode.id]))].join(
                  " ",
                )}
              </p>
            )}
            {health?.embeddings.status === "loading" && (
              <p className="hint">
                The embedding model is still loading on this server.
              </p>
            )}
            {reasons[form.mode] && (
              <Alert tone="warn">
                {MODES.find((mode) => mode.id === form.mode)?.label} is saved,
                but it can&rsquo;t run here, so questions run as keyword search.
              </Alert>
            )}
          </div>

          <RangeSetting
            id="settings-k"
            label="Matches per question"
            unit={form.k === 1 ? "passage" : "passages"}
            help="How many top passages search hands to the context step."
            value={form.k}
            range={ranges.k}
            defaultValue={defaults.k}
            onChange={(value) => set("k", value)}
          />
          <RangeSetting
            id="settings-rrf"
            label="RRF constant"
            unit=""
            help={`Hybrid search adds 1 / (constant + rank) from each ranking. A small constant makes the top few ranks count for much more; a large one evens ranks out, so being found by both searches counts for more.${semanticOff ? " Semantic search is off on this server, so this has no effect for now." : ""}`}
            value={form.rrfConstant}
            range={ranges.rrfConstant}
            defaultValue={defaults.rrfConstant}
            exact
            onChange={(value) => set("rrfConstant", value)}
          />
          <RangeSetting
            id="settings-budget"
            label="Context word budget"
            unit="words"
            help="The most words of manual text the model reads for one question. Sections are added in rank order; one that doesn't fit is cut to its matched passages and their neighbours, or left out."
            value={form.budgetWords}
            range={ranges.budgetWords}
            defaultValue={defaults.budgetWords}
            step={10}
            onChange={(value) => set("budgetWords", value)}
          />
        </section>
      </div>

      <div className={`panel ${styles.actions}`}>
        <button
          type="submit"
          className="btn primary"
          disabled={!changed.length || invalid.length > 0 || busy !== null}
        >
          {busy === "save" ? (
            <LoaderCircle size={16} className="spin" aria-hidden />
          ) : (
            <Check size={16} aria-hidden />
          )}
          {busy === "save" ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          className={`btn quiet ${styles.quietButton}`}
          disabled={busy !== null || (atDefaults && !changed.length)}
          title={
            atDefaults && !changed.length ? "These are the defaults" : undefined
          }
          onClick={reset}
        >
          {busy === "reset" ? (
            <LoaderCircle size={15} className="spin" aria-hidden />
          ) : (
            <RotateCcw size={15} aria-hidden />
          )}
          Reset to defaults
        </button>
        <p className={styles.status} role="status">
          {notice ? (
            <span className={notice.tone === "bad" ? styles.bad : styles.ok}>
              {notice.text}
            </span>
          ) : changed.length ? (
            <span className="muted">
              {plural(changed.length, "unsaved change")}
            </span>
          ) : null}
        </p>
        {notice?.undo && (
          <button
            type="button"
            className={`btn quiet small ${styles.quietButton}`}
            disabled={busy !== null}
            onClick={() => notice.undo && undo(notice.undo)}
          >
            <Undo2 size={14} aria-hidden /> Undo
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- fixed parts

function Policy({ settings }: { settings: SettingsResponse }) {
  return (
    <section
      className={`panel ${styles.section}`}
      aria-labelledby="settings-policy"
    >
      <div className={styles.policyHead}>
        <span className={styles.lock} aria-hidden>
          <Lock size={18} />
        </span>
        <h2 id="settings-policy">Model policy</h2>
        <span className="chip tiny flat">Read only</span>
      </div>
      <div className={styles.locked}>
        <span id="settings-always-ask">
          Always ask which model when none is chosen
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={settings.policy.alwaysAsk}
          aria-labelledby="settings-always-ask"
          aria-describedby="settings-policy-text"
          disabled
        />
      </div>
      <p id="settings-policy-text" className={styles.policyText}>
        {settings.policy.text}
      </p>
    </section>
  );
}

function Fixed({ settings }: { settings: SettingsResponse }) {
  return (
    <section
      className={`panel ${styles.section}`}
      aria-labelledby="settings-fixed"
    >
      <div className={styles.head}>
        <h2 id="settings-fixed">What the model is told</h2>
        <p className="muted small">
          Shown with your saved settings. The rules can&rsquo;t be changed; one
          of them quotes your &ldquo;not found&rdquo; sentence.
        </p>
      </div>
      <div className={styles.group}>
        <h3 id="settings-rules">Grounding rules</h3>
        <pre className={styles.pre} aria-labelledby="settings-rules">
          {settings.rules}
        </pre>
      </div>
      <div className={styles.group}>
        <h3 id="settings-prompt">The system prompt as sent</h3>
        <p className="hint">
          As it reads with no model chosen. For a question, the chosen
          model&rsquo;s name (and revision) takes the place of &ldquo;the
          manuals in this library (no model was chosen)&rdquo;.
        </p>
        <pre className={styles.pre} aria-labelledby="settings-prompt">
          {settings.prompt}
        </pre>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the page

export function SettingsView() {
  const { settings, health } = useFinder();
  // Fetched here only when the shared copy hasn't arrived and "Try again" is used.
  const [fetched, setFetched] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const current = settings ?? fetched;

  const retry = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setFetched(await getSettings());
    } catch (cause) {
      setLoadError(errorMessage(cause, "Your settings couldn't be loaded."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <PageHead eyebrow="Settings" title="Answers and search">
        Answer and search settings are saved for this browser&rsquo;s workspace
        on the Finder backend; the theme is kept in this browser. The model
        policy and the grounding rules are fixed, and shown as they are sent.
      </PageHead>

      {current ? (
        <PrefsForm settings={current} health={health} />
      ) : (
        <div className={`panel ${styles.section}`}>
          {health ? (
            <Spinner label="Loading your settings…" />
          ) : (
            <Alert tone="warn">
              The Finder backend isn&rsquo;t reachable, so your answer and
              search settings can&rsquo;t be shown or changed right now. The
              theme below still works.
            </Alert>
          )}
          {loadError && <Alert tone="bad">{loadError}</Alert>}
          <div>
            <button
              type="button"
              className="btn small"
              disabled={loading}
              onClick={() => void retry()}
            >
              {loading && (
                <LoaderCircle size={15} className="spin" aria-hidden />
              )}
              Try again
            </button>
          </div>
        </div>
      )}

      <div className="grid-2">
        <Appearance />
        {current && <Policy settings={current} />}
      </div>

      {current && <Fixed settings={current} />}
    </div>
  );
}
