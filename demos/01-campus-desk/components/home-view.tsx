"use client";

import {
  ArrowRight,
  BookOpen,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRag } from "./rag-provider";
import { plural, titleCase, UploadPanel } from "./ui";

function HeroPanel() {
  const { documents, profile } = useRag();
  const list = documents ?? [];
  const pages = list.reduce((sum, d) => sum + d.pages, 0);
  const passages = list.reduce((sum, d) => sum + d.chunks, 0);
  return (
    <aside className="hero-panel" aria-label="The library at a glance">
      <div className="glance">
        <p className="glance-title">
          <BookOpen size={15} aria-hidden /> In the library
        </p>
        {list.length ? (
          <ul className="glance-list">
            {list.slice(0, 4).map((d) => (
              <li key={d.id}>
                <span className="glance-doc">{d.name}</span>
                <small>
                  {d.pages
                    ? plural(d.pages, "page")
                    : plural(d.chunks, "passage")}
                </small>
              </li>
            ))}
            {list.length > 4 && (
              <li className="glance-more">and {list.length - 4} more</li>
            )}
          </ul>
        ) : (
          <p className="glance-empty">
            No documents yet. Add a handbook to begin.
          </p>
        )}
        <dl className="glance-stats">
          <div>
            <dt>Documents</dt>
            <dd>{list.length}</dd>
          </div>
          <div>
            <dt>Pages</dt>
            <dd>{pages.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Passages</dt>
            <dd>{passages.toLocaleString()}</dd>
          </div>
        </dl>
      </div>
      {profile && profile.topics.length > 0 && (
        <p className="glance-tag">
          <Sparkles size={13} aria-hidden /> {profile.topics.length} topics
          students can ask about
        </p>
      )}
    </aside>
  );
}

export function HomeView() {
  const {
    profile,
    profileState,
    documents,
    health,
    ask,
    refreshProfile,
    streaming,
  } = useRag();
  const router = useRouter();
  const hasDocuments = (documents?.length ?? 0) > 0;
  const loading = documents === null;

  const start = (question: string) => {
    if (streaming) return;
    void ask(question);
    router.push("/ask");
  };

  if (!hasDocuments && !loading) {
    return (
      <div className="home">
        <section className="hero hero-empty">
          <div className="hero-copy">
            <span className="kicker">Welcome</span>
            <h1>
              Your school&rsquo;s documents, <em>answered.</em>
            </h1>
            <p className="lede">
              Campus Guide reads the handbooks, guides and notices you add, and
              answers students&rsquo; questions from them — short, clear, and
              with the exact page cited. Nothing is typed in by hand: everything
              the guide knows comes from the documents.
            </p>
            {!health && (
              <p className="error">
                The Python backend isn&rsquo;t reachable. Start it with{" "}
                <code>npm run api</code> and reload.
              </p>
            )}
          </div>
          <HeroPanel />
        </section>
        <section className="section">
          <h2>Start by adding documents</h2>
          <p className="muted">
            Add one or several at once: a student handbook, course guides, exam
            rules, fee schedules, the academic calendar. The welcome page below
            will then be written from them.
          </p>
          <UploadPanel />
        </section>
      </div>
    );
  }

  const writing =
    profileState === "writing" || profileState === "loading" || loading;
  const title = profile?.institution
    ? titleCase(profile.institution)
    : writing
      ? ""
      : "your school";

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <span className="kicker">
            {profile?.unit ? titleCase(profile.unit) : "Student guide"}
          </span>
          <h1>
            {writing && !profile ? (
              <span className="skeleton skeleton-title" aria-label="Loading" />
            ) : (
              <>
                Welcome to <em>{title}</em>
              </>
            )}
          </h1>
          {writing && !profile ? (
            <>
              <span className="skeleton" />
              <span className="skeleton skeleton-short" />
              <p className="muted">
                <Loader2 size={14} className="spin" aria-hidden /> Reading your
                documents to write this page…
              </p>
            </>
          ) : (
            <>
              {profile?.tagline && <p className="tagline">{profile.tagline}</p>}
              <p className="lede">
                {profile?.welcome ||
                  "Ask anything about the documents in the library and get a short, cited answer."}
              </p>
            </>
          )}
          <div className="hero-actions">
            <Link href="/ask" className="button button-big">
              Get started <ArrowRight size={17} aria-hidden />
            </Link>
            <Link href="/library" className="button button-outline button-big">
              <BookOpen size={16} aria-hidden /> Browse the library
            </Link>
          </div>
          {profileState === "failed" && (
            <p className="error">
              The welcome page couldn&rsquo;t be written.{" "}
              <button
                type="button"
                className="link"
                onClick={() => void refreshProfile(true)}
              >
                <RefreshCw size={13} aria-hidden /> Try again
              </button>
            </p>
          )}
        </div>
        <HeroPanel />
      </section>

      <section className="section" id="quick-actions">
        <div className="section-head">
          <h2>Quick actions</h2>
          <p className="muted">
            Questions your documents answer well. Pick one, or ask your own.
          </p>
        </div>
        {profile?.quickActions.length ? (
          <div className="quick-grid">
            {profile.quickActions.map((action, index) => (
              <button
                key={action.question}
                type="button"
                className="quick-card"
                onClick={() => start(action.question)}
                disabled={streaming}
              >
                <span className="quick-n" aria-hidden>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong>{action.label}</strong>
                <small>{action.question}</small>
                <ArrowRight size={15} className="quick-arrow" aria-hidden />
              </button>
            ))}
          </div>
        ) : writing ? (
          <div className="quick-grid" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="quick-card skeleton-card" />
            ))}
          </div>
        ) : (
          <p className="muted">
            {health?.generation
              ? "No quick actions yet."
              : "Quick actions need a model key on the server."}
          </p>
        )}
      </section>

      <div className="split">
        {profile && profile.topics.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2>What you can ask about</h2>
            </div>
            <div className="chips chips-big">
              {profile.topics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  className="chip chip-button"
                  onClick={() => start(`Tell me about ${topic.toLowerCase()}.`)}
                  disabled={streaming}
                >
                  {topic}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <h2>How your guide answers</h2>
            <p className="muted">
              It never guesses. Every answer is built from the documents in
              three steps.
            </p>
          </div>
          <ol className="how-row">
            <li>
              <span className="how-n">1</span>
              <strong>Find</strong>
              <p>
                The passages most related to your question are pulled from the
                documents.
              </p>
            </li>
            <li>
              <span className="how-n">2</span>
              <strong>Read</strong>
              <p>
                Those passages, and only those, are handed to the assistant with
                your question.
              </p>
            </li>
            <li>
              <span className="how-n">3</span>
              <strong>Answer</strong>
              <p>
                It writes a short answer and cites the page each fact came from.
              </p>
            </li>
          </ol>
          <Link href="/how-it-works" className="link">
            <Sparkles size={14} aria-hidden /> See it in detail
          </Link>
        </section>
      </div>
      {profile && (
        <p className="fine">
          This page was written by {profile.model} from the documents in the
          library.{" "}
          <button
            type="button"
            className="link"
            onClick={() => void refreshProfile(true)}
            disabled={profileState === "writing"}
          >
            <RefreshCw size={12} aria-hidden /> Rewrite
          </button>
        </p>
      )}
    </div>
  );
}
