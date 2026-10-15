"use client";

import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  Library,
  LoaderCircle,
} from "lucide-react";
import Link from "next/link";
import { plural, webUrl } from "@/lib/text";
import { useFinder } from "./finder-provider";
import { Alert } from "./ui";
import styles from "./onboarding.module.css";

/**
 * The first screen of an empty library: what Finder does, the sample
 * library it can load (real, openly licensed documentation, as published),
 * and the way to add one's own manuals.
 */
export function Onboarding() {
  const { library, sampleState, sampleError, addSample } = useFinder();
  if (!library) return null;
  const sample = library.sample;
  const loading = sampleState === "loading";

  return (
    <section className={styles.onboarding} aria-labelledby="onboarding-title">
      <header className={styles.intro}>
        <span className="eyebrow">Finder</span>
        <h1 id="onboarding-title">The exact passage, for the exact model</h1>
        <p className="lead">
          Finder searches device manuals by fault code or symptom, using only
          the passages that apply to the model in front of you. Each answer
          shows the numbered passages it comes from, and passages for look-alike
          models are set aside before anything is written.
        </p>
      </header>

      <div className={styles.cards}>
        {sample.available ? (
          <article
            className={`panel panel-lg ${styles.sample}`}
            aria-labelledby="sample-title"
          >
            <div className={styles.cardHead}>
              <span className={styles.badge} aria-hidden>
                <BookOpen size={20} />
              </span>
              <div>
                <span className="eyebrow">Sample library</span>
                <h2 id="sample-title">
                  {sample.publisher
                    ? `Manuals from ${sample.publisher}`
                    : "Openly licensed manuals"}
                </h2>
              </div>
            </div>
            <p className="muted">
              {sample.licence && (
                <>
                  Published under{" "}
                  {webUrl(sample.licenceUrl) ? (
                    <a
                      href={webUrl(sample.licenceUrl)!}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.licence}
                    >
                      {sample.licence}
                      <ExternalLink size={13} aria-hidden />
                    </a>
                  ) : (
                    sample.licence
                  )}
                  .{" "}
                </>
              )}
              Every passage is the documentation&rsquo;s own text.
            </p>
            <ul
              className={styles.documents}
              aria-label="Manuals in the sample library"
            >
              {sample.documents.map((document) => (
                <li key={document.id}>
                  <span>{document.title}</span>
                  <span className={styles.units}>
                    {plural(document.units, "passage")}
                  </span>
                </li>
              ))}
            </ul>
            {sample.queries > 0 && (
              <p className="small muted">
                It comes with {plural(sample.queries, "labelled question")} for
                the Evaluate page.
              </p>
            )}
            {sampleState === "failed" && (
              <Alert tone="bad">
                {sampleError ?? "The sample library couldn't be loaded."}
              </Alert>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                className="btn primary"
                onClick={() => void addSample()}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <LoaderCircle size={16} className="spin" aria-hidden />{" "}
                    Loading the sample library…
                  </>
                ) : sampleState === "failed" ? (
                  "Try again"
                ) : (
                  "Load the sample library"
                )}
              </button>
              <span className="sr-only" aria-live="polite">
                {loading ? "Loading the sample library." : ""}
              </span>
            </div>
          </article>
        ) : (
          <Alert tone="info">
            The sample library isn&rsquo;t available on this server. Add your
            own manuals to start.
          </Alert>
        )}

        <article className={`flat ${styles.own}`} aria-labelledby="own-title">
          <div className={styles.cardHead}>
            <span className={styles.badge} aria-hidden>
              <Library size={20} />
            </span>
            <div>
              <span className="eyebrow">Your manuals</span>
              <h2 id="own-title">Add your own</h2>
            </div>
          </div>
          <p className="muted">
            Upload PDF, Word, text or Markdown manuals on the Library page, then
            confirm the models each one covers. They&rsquo;re kept in a private
            workspace tied to this browser.
          </p>
          <Link href="/library" className="btn">
            Go to the library <ArrowRight size={16} aria-hidden />
          </Link>
        </article>
      </div>
    </section>
  );
}
