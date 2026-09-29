"use client";

import {
  ArrowRight,
  BookOpenText,
  FlaskConical,
  GraduationCap,
  Loader2,
  MessagesSquare,
  Quote,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { plural, readingMinutes } from "@/lib/text";
import { useStudy } from "./study-provider";
import { SampleButton, Stat, UploadPanel } from "./ui";

const WAYS = [
  {
    href: "/ask",
    icon: MessagesSquare,
    title: "Ask",
    text: "Get an explanation, the exact sections behind it and the original text, with every exception your notes state kept in view.",
  },
  {
    href: "/compare",
    icon: FlaskConical,
    title: "Compare",
    text: "Run one question against section-aware and fixed-length chunks, and see what each one hands the model.",
  },
  {
    href: "/practice",
    icon: GraduationCap,
    title: "Practise",
    text: "Quizzes and flashcards written from your notes, each one tied to the section and sentence it came from.",
  },
] as const;

function Welcome() {
  const { health } = useStudy();
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">Study Companion</span>
          <h1>
            Understand your notes, <em>not just search them.</em>
          </h1>
          <p className="lead">
            Add your lecture notes or a chapter you are revising. Ask what you
            don&rsquo;t follow, and get an explanation that stays inside what
            your notes say and shows you where.
          </p>
          <div className="row">
            <SampleButton />
            <Link href="/how-it-works" className="button button-outline">
              How it works
            </Link>
          </div>
          {!health && (
            <p className="fine">
              Waiting for the backend. When running locally, start it with{" "}
              <code>npm run api</code>.
            </p>
          )}
        </div>
        <figure className="hero-card" aria-label="An example answer">
          <p className="hero-q">Does negative feedback guarantee stability?</p>
          <p className="hero-a">
            No. Negative feedback <mark>does not guarantee stability</mark>
            <span className="ref">1</span>. With too much loop gain or delay the
            loop can overshoot or oscillate<span className="ref">1</span>
            <span className="ref">2</span>.
          </p>
          <figcaption>
            <Quote size={13} aria-hidden /> From the sample notes · §1 Negative
            feedback · §2 Stability
          </figcaption>
        </figure>
      </section>
      <section className="ways">
        {WAYS.map(({ href, icon: Icon, title, text }) => (
          <article key={href} className="card way">
            <span className="way-icon" aria-hidden>
              <Icon size={18} />
            </span>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="card">
        <h2 className="card-title">Start with your own notes</h2>
        <UploadPanel />
      </section>
    </div>
  );
}

export function HomeView() {
  const { documents, overviewPending, ask, streaming, health } = useStudy();
  const router = useRouter();

  if (documents === null)
    return (
      <p className="muted">
        <Loader2 size={14} className="spin" aria-hidden /> Opening your notes…
      </p>
    );
  if (!documents.length) return <Welcome />;

  const words = documents.reduce((sum, d) => sum + d.words, 0);
  const sections = documents.reduce((sum, d) => sum + d.sections, 0);
  const questions = documents
    .flatMap((d) => d.overview?.questions ?? [])
    .slice(0, 6);
  const go = (question: string) => {
    void ask(question, false);
    router.push("/ask");
  };

  return (
    <div className="home">
      <header className="page-head">
        <div>
          <span className="eyebrow">Your notebook</span>
          <h1>
            What would you like to <em>understand</em> today?
          </h1>
        </div>
        <div className="stats">
          <Stat label="Sets of notes" value={documents.length} />
          <Stat label="Sections" value={sections.toLocaleString("en")} />
          <Stat
            label="Reading time"
            value={`${readingMinutes(words)} min`}
            hint={`${words.toLocaleString("en")} words at about 200 a minute`}
          />
        </div>
      </header>

      {questions.length > 0 && (
        <section>
          <h2 className="section-title">Questions your notes can answer</h2>
          <div className="suggestions">
            {questions.map((question) => (
              <button
                key={question}
                type="button"
                disabled={streaming || !health}
                onClick={() => go(question)}
              >
                {question}
                <ArrowRight size={14} aria-hidden />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="ways">
        {WAYS.map(({ href, icon: Icon, title, text }) => (
          <Link key={href} href={href} className="card way way-link">
            <span className="way-icon" aria-hidden>
              <Icon size={18} />
            </span>
            <h3>
              {title} <ArrowRight size={15} aria-hidden />
            </h3>
            <p>{text}</p>
          </Link>
        ))}
      </section>

      <section>
        <h2 className="section-title">Your notes</h2>
        <div className="note-grid">
          {documents.map((d) => (
            <Link
              key={d.id}
              href={`/notes?doc=${encodeURIComponent(d.id)}`}
              className="card note-card"
            >
              <h3>
                <BookOpenText size={16} aria-hidden /> {d.name}
                {d.sample && <span className="tag">sample</span>}
              </h3>
              {d.overview ? (
                <>
                  <p>{d.overview.summary}</p>
                  <div className="chips">
                    {d.overview.keyTerms.slice(0, 6).map((term) => (
                      <span key={term} className="chip">
                        {term}
                      </span>
                    ))}
                  </div>
                </>
              ) : overviewPending[d.id] ? (
                <p className="muted">
                  <Loader2 size={13} className="spin" aria-hidden /> Reading a
                  sample of these notes to describe them…
                </p>
              ) : null}
              <p className="fine">
                {plural(d.sections, "section")} · {d.words.toLocaleString("en")}{" "}
                words
                {d.pages ? ` · ${plural(d.pages, "page")}` : ""}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
