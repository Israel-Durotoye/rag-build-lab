"use client";

import {
  ArrowRight,
  BookOpenText,
  Download,
  ExternalLink,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { formatBytes, plural, webUrl } from "@/lib/text";
import type { DocumentFormat, DocumentSummary, Library } from "@/lib/types";
import { errorMessage, useFinder } from "./finder-provider";
import { Alert, ModelChip, PageHead, Spinner } from "./ui";
import { UploadPanel } from "./upload-panel";
import styles from "./library-view.module.css";

export const FORMAT_LABEL: Record<DocumentFormat, string> = {
  sample: "Sample",
  pdf: "PDF",
  word: "Word",
  text: "Text",
};

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const DAY_UTC = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "15 Oct 2026". A bare date ("2026-10-15") reads as that day everywhere. */
export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (/^\d{4}-\d{2}-\d{2}$/.test(value) ? DAY_UTC : DAY).format(date);
}

/** Only web addresses are drawn as links. */
export { webUrl };

/** A link that leaves Finder, marked as such. */
export function External({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={styles.external}>
      {children}
      <ExternalLink size={13} aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function semanticOn(status: string | undefined): boolean {
  return status === "ready" || status === "loading";
}

function Capacity({
  used,
  limit,
  models,
}: {
  used: number;
  limit: number;
  models: number;
}) {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <div className={styles.capacity}>
      <span className="eyebrow">This browser&rsquo;s library</span>
      <p>
        <strong className={styles.capacityNumber}>{used}</strong>
        <span className="muted"> of {plural(limit, "manual")}</span>
      </p>
      <div className={styles.capacityMeter} aria-hidden>
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <p className="small muted">{plural(models, "model")} covered</p>
    </div>
  );
}

/** The bundled sample library: what it holds, its licence, and loading it. */
function SampleCard({ library }: { library: Library }) {
  const { health, sampleState, sampleError, addSample } = useFinder();
  const titleId = useId();
  const { sample } = library;
  if (!sample.available) return null;

  const present = new Set(
    library.documents.filter((doc) => doc.sample).map((doc) => doc.id),
  );
  const inLibrary = sample.documents.filter((doc) =>
    present.has(doc.id),
  ).length;
  const passages = sample.documents.reduce((sum, doc) => sum + doc.units, 0);
  const loading = sampleState === "loading";
  const licenceUrl = webUrl(sample.licenceUrl);

  return (
    <section className={`panel ${styles.sample}`} aria-labelledby={titleId}>
      <div className={styles.sampleHead}>
        <span className={styles.badge} aria-hidden>
          <BookOpenText size={22} />
        </span>
        <div className={styles.cardHead}>
          <span className="eyebrow">Sample library</span>
          <h2 id={titleId}>
            {sample.publisher
              ? `${sample.publisher} documentation`
              : "Sample manuals"}
          </h2>
        </div>
      </div>
      <p className="muted">
        {plural(sample.documents.length, "manual")} and{" "}
        {plural(passages, "passage")}
        {sample.licence && (
          <>
            , published under{" "}
            {licenceUrl ? (
              <External href={licenceUrl}>{sample.licence}</External>
            ) : (
              sample.licence
            )}
          </>
        )}
        . Passages keep their original wording; Finder splits each manual into
        sections and tags every passage with the models it applies to.
      </p>
      {!sample.loaded && (
        <ul
          className={styles.sampleList}
          aria-label="Manuals in the sample library"
        >
          {sample.documents.map((doc) => (
            <li key={doc.id}>
              <span>{doc.title}</span>
              <span className="mono small muted">
                {present.has(doc.id) ? "in your library · " : ""}
                {plural(doc.units, "passage")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {sample.queries > 0 && (
        <p className="small muted">
          It comes with{" "}
          {plural(sample.queries, "labelled query", "labelled queries")} for
          comparing search modes on the <Link href="/evaluate">Evaluate</Link>{" "}
          page.
        </p>
      )}
      <div className={styles.sampleActions}>
        {sample.loaded ? (
          <p className="status">
            <i aria-hidden /> In your library
          </p>
        ) : loading ? (
          <Spinner label="Loading the sample library…" />
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={!health}
            onClick={() => void addSample()}
          >
            <Download size={16} aria-hidden /> Load the sample library
          </button>
        )}
        {!sample.loaded && !loading && inLibrary > 0 && (
          <span className="small muted">
            {inLibrary} of {sample.documents.length} are already here; loading
            adds the rest.
          </span>
        )}
      </div>
      {loading && semanticOn(health?.embeddings.status) && (
        <p className="small muted">
          The first load on a server embeds every passage, which takes longer.
        </p>
      )}
      {sampleState === "failed" && sampleError && (
        <Alert tone="bad">{sampleError}</Alert>
      )}
    </section>
  );
}

/** One manual: what it is, the models it covers, its size, and removing it. */
function ManualCard({ doc }: { doc: DocumentSummary }) {
  const { health, modelById, removeDocument } = useFinder();
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const [kept, setKept] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = `/library/${encodeURIComponent(doc.id)}`;
  const source = doc.source;
  const pageUrl = webUrl(source?.url);
  const licenceUrl = webUrl(source?.licenceUrl);

  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      // On success the library refreshes and this card goes with it.
      await removeDocument(doc.id);
    } catch (cause) {
      setError(
        errorMessage(cause, "This manual couldn't be removed. Try again."),
      );
      setRemoving(false);
      setConfirming(false);
    }
  };

  return (
    <article className={`panel ${styles.card}`} aria-labelledby={titleId}>
      <div className={styles.cardTop}>
        <span className="chip tiny flat">{FORMAT_LABEL[doc.format]}</span>
        {doc.sample ? (
          doc.version && (
            <span className="mono small faint" title="Version of the source">
              {doc.version}
            </span>
          )
        ) : (
          <span className="small faint">
            {formatBytes(doc.bytes)}
            {doc.pages > 0 && ` · ${plural(doc.pages, "page")}`} · added{" "}
            {formatDate(doc.addedAt)}
          </span>
        )}
      </div>
      <h3 id={titleId} className={styles.cardTitle}>
        <Link href={href}>{doc.name}</Link>
      </h3>
      {source && (
        <p className={styles.source}>
          {source.publisher && <span>{source.publisher}</span>}
          {source.licence &&
            (licenceUrl ? (
              <External href={licenceUrl}>{source.licence}</External>
            ) : (
              <span>{source.licence}</span>
            ))}
          {pageUrl && <External href={pageUrl}>Original page</External>}
        </p>
      )}
      <div className={styles.cardModels}>
        <span className="eyebrow">Models</span>
        {doc.models.length ? (
          <span className="tag-row">
            {doc.models.map((id) => (
              <ModelChip
                key={id}
                model={modelById(id) ?? { id, short: id, name: id }}
              />
            ))}
          </span>
        ) : (
          <span className="small muted">
            No models listed: applies to every model
          </span>
        )}
      </div>
      <dl className={styles.stats}>
        <div>
          <dt>Sections</dt>
          <dd>{doc.sections.toLocaleString("en")}</dd>
        </div>
        <div>
          <dt>Passages</dt>
          <dd>{doc.units.toLocaleString("en")}</dd>
        </div>
        <div>
          <dt>Codes</dt>
          <dd>{doc.codes.toLocaleString("en")}</dd>
        </div>
      </dl>
      {!doc.sample && !doc.modelsConfirmed && (
        <Alert tone="warn">
          Models not confirmed. Until you list them, every passage applies to
          every model.{" "}
          <Link href={`${href}#models`}>
            Confirm the models<span className="sr-only"> of {doc.name}</span>
          </Link>
        </Alert>
      )}
      {(doc.truncated ||
        doc.ocrPages > 0 ||
        (semanticOn(health?.embeddings.status) && !doc.embeddings)) && (
        <ul className={styles.notes}>
          {doc.truncated && (
            <li>
              Only part of this file was read: it went over Finder&rsquo;s
              limits.
            </li>
          )}
          {doc.ocrPages > 0 && (
            <li>{plural(doc.ocrPages, "page")} read with OCR.</li>
          )}
          {semanticOn(health?.embeddings.status) && !doc.embeddings && (
            <li>Not embedded, so only keyword search finds it.</li>
          )}
        </ul>
      )}
      {error && <Alert tone="bad">{error}</Alert>}
      {confirming ? (
        <div
          className={styles.confirm}
          role="group"
          aria-label={`Remove ${doc.name}?`}
        >
          <p className="small">
            Remove &ldquo;{doc.name}&rdquo;? Its passages leave every search.
            {doc.sample
              ? " Loading the sample library brings it back."
              : " To bring it back, upload the file again."}
          </p>
          <div className="row">
            <button
              type="button"
              className="btn small danger"
              disabled={removing}
              onClick={() => void remove()}
            >
              {removing ? (
                <LoaderCircle size={15} className="spin" aria-hidden />
              ) : (
                <Trash2 size={15} aria-hidden />
              )}
              {removing ? "Removing…" : "Remove"}
            </button>
            <button
              type="button"
              className="btn small quiet"
              disabled={removing}
              autoFocus
              onClick={() => {
                setConfirming(false);
                setKept(true);
              }}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.cardFoot}>
          <button
            type="button"
            className="btn small quiet"
            autoFocus={kept}
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={15} aria-hidden /> Remove
            <span className="sr-only"> {doc.name}</span>
          </button>
          <Link href={href} className="btn small">
            Open<span className="sr-only"> {doc.name}</span>
            <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      )}
    </article>
  );
}

function ManualGroup({
  eyebrow,
  title,
  documents,
}: {
  eyebrow: string;
  title: string;
  documents: DocumentSummary[];
}) {
  const titleId = useId();
  return (
    <section className={styles.group} aria-labelledby={titleId}>
      <div className={styles.groupHead}>
        <div className={styles.cardHead}>
          <span className="eyebrow">{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <span className="muted small">
          {plural(documents.length, "manual")}
        </span>
      </div>
      <ul className={styles.cards}>
        {documents.map((doc) => (
          <li key={doc.id}>
            <ManualCard doc={doc} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Placeholder() {
  return (
    <div className={`panel ${styles.placeholder}`} aria-hidden>
      <div className="skeleton" style={{ width: "40%" }} />
      <div className="skeleton" style={{ width: "75%", minHeight: 22 }} />
      <div className="skeleton" style={{ width: "90%" }} />
      <div className="skeleton" style={{ width: "60%" }} />
    </div>
  );
}

/**
 * The Library page: the sample library, the upload panel, and every manual
 * in this browser's workspace as a card.
 */
export function LibraryView() {
  const { health, library, libraryError, refreshLibrary } = useFinder();
  const documents = library?.documents ?? [];
  // Newest uploads first; sample manuals in the sample library's own order.
  const uploads = documents.filter((doc) => !doc.sample).toReversed();
  const order = new Map(library?.sample.documents.map((doc, i) => [doc.id, i]));
  const samples = documents
    .filter((doc) => doc.sample)
    .toSorted(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  const limit = health?.limits.documents ?? null;

  return (
    <div className={`stack ${styles.page}`}>
      <PageHead
        eyebrow="Library"
        title="Manuals"
        aside={
          library && limit !== null ? (
            <Capacity
              used={documents.length}
              limit={limit}
              models={library.models.length}
            />
          ) : undefined
        }
      >
        Everything Finder searches. Each manual is split into sections and
        passages, and every passage records the models it applies to, so an
        answer for one model leaves out passages written for another.
      </PageHead>

      {!health && (
        <Alert tone="warn">
          Finder&rsquo;s backend isn&rsquo;t reachable, so the library
          can&rsquo;t be shown. It may still be starting; this page fills in
          once it answers.
        </Alert>
      )}
      {health && libraryError && (
        <div className={styles.errorRow}>
          <Alert tone="bad">{libraryError}</Alert>
          <button
            type="button"
            className="btn small"
            onClick={() => void refreshLibrary()}
          >
            Try again
          </button>
        </div>
      )}

      <div className={styles.intake}>
        {library ? (
          <SampleCard library={library} />
        ) : health && !libraryError ? (
          <Placeholder />
        ) : null}
        <UploadPanel />
      </div>

      {library ? (
        documents.length === 0 ? (
          <div className={`well ${styles.emptyList}`}>
            <h2>No manuals yet</h2>
            <p className="muted">
              Load the sample library or add your own manuals above. Finder
              answers only from the manuals in this library.
            </p>
          </div>
        ) : (
          <>
            {uploads.length > 0 && (
              <ManualGroup
                eyebrow="Uploads"
                title="Your manuals"
                documents={uploads}
              />
            )}
            {samples.length > 0 && (
              <ManualGroup
                eyebrow="Sample library"
                title="Sample manuals"
                documents={samples}
              />
            )}
          </>
        )
      ) : (
        health &&
        !libraryError && (
          <div className={styles.cards} aria-busy="true">
            <Placeholder />
            <Placeholder />
          </div>
        )
      )}
    </div>
  );
}
