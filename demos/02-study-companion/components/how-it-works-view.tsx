"use client";

import {
  ArrowRight,
  BookOpenText,
  FileText,
  PenLine,
  Scissors,
  Search,
} from "lucide-react";
import Link from "next/link";
import { formatMs, plural } from "@/lib/text";
import { useStudy } from "./study-provider";
import { CHUNKING_LABEL, LayerNav, PageHead, TurnPicker } from "./ui";

export function HowItWorksView() {
  const { inspected, documents, settings, health } = useStudy();
  const prefs = settings?.settings;
  const done = inspected?.done;
  const retrieval = inspected?.retrieval;
  const context = inspected?.context;
  const sections = (documents ?? []).reduce((sum, d) => sum + d.sections, 0);

  const steps = [
    {
      href: "/notes",
      icon: Scissors,
      name: "Before any question · Chunking",
      title: "Your notes are cut into chunks, twice",
      text: `Each file is read and divided at its headings into sections. Then it is chunked two ways: one chunk per section, and fixed windows of ${prefs?.chunkWords ?? 50} words. Both are indexed by keyword and by meaning.`,
      fact: documents?.length
        ? `${plural(documents.length, "set")} of notes · ${plural(sections, "section")}`
        : "No notes yet",
    },
    {
      href: "/retrieval",
      icon: Search,
      name: "Step 1 · Retrieval",
      title: "The chunks most likely to answer are found",
      text: "Keyword search ranks chunks by the words they share with the question. Semantic search ranks them by closeness in meaning. The two rankings are fused. A follow-up is first turned into a full query using your earlier questions, never an earlier answer.",
      fact: retrieval
        ? `${plural(retrieval.selected.length, "chunk")} of ${retrieval.totalChunks} selected · ${CHUNKING_LABEL[retrieval.chunking].toLowerCase()} · ${formatMs(retrieval.ms)}`
        : null,
    },
    {
      href: "/context",
      icon: BookOpenText,
      name: "Step 2 · Context",
      title: "Small matches grow to their section, within a budget",
      text: `A fragment can miss the sentence that matters. A match under ${prefs?.expandBelowWords ?? 60} words is swapped for its whole section when that fits the budget of ${prefs?.budgetWords ?? 600} words. The result, numbered, goes into the prompt with the rules the model must follow.`,
      fact: context
        ? `${plural(context.items.length, "section")} · ${context.budget.usedWords} of ${context.budget.budgetWords} words · ${plural(context.items.filter((i) => i.expanded).length, "match", "matches")} expanded`
        : null,
    },
    {
      href: "/generation",
      icon: PenLine,
      name: "Step 3 · Generation",
      title: "The model explains, and its citations are checked",
      text: "The model reads only those sections and writes an explanation that cites them. Every citation number is checked against the sections it was given. Without a model, sentences are copied from your notes instead and labelled as such.",
      fact: done
        ? done.answer
          ? `${plural(done.citations.length, "citation")} checked · ${formatMs(done.timings.generationMs)}`
          : "No model wrote this one"
        : null,
    },
  ];

  return (
    <div className="how">
      <LayerNav />
      <PageHead
        eyebrow="How it works"
        title={
          <>
            The model is never trained on your notes. <em>It reads them.</em>
          </>
        }
        aside={<TurnPicker />}
      >
        Each time you ask, the parts of your notes most likely to hold the
        answer are found and placed in the model&rsquo;s prompt. The model
        explains from what it was given and says which section each statement
        came from. That is retrieval-augmented generation.
      </PageHead>

      {inspected ? (
        <p className="how-question">
          <FileText size={14} aria-hidden /> Showing what happened for{" "}
          <q>{inspected.question}</q>
        </p>
      ) : (
        <p className="how-question">
          <FileText size={14} aria-hidden />{" "}
          <span>
            <Link href="/ask" className="link">
              Ask a question
            </Link>{" "}
            and each step below fills in with what actually happened.
          </span>
        </p>
      )}

      <ol className="how-steps">
        {steps.map(({ href, icon: Icon, name, title, text, fact }) => (
          <li key={href}>
            <Link href={href} className="card how-step">
              <span className="way-icon" aria-hidden>
                <Icon size={18} />
              </span>
              <div>
                <span className="eyebrow">{name}</span>
                <h2>{title}</h2>
                <p>{text}</p>
                {fact && <p className="how-fact">{fact}</p>}
              </div>
              <ArrowRight size={16} aria-hidden className="how-arrow" />
            </Link>
          </li>
        ))}
      </ol>

      <section className="card how-honest">
        <h2 className="card-title">What this does not promise</h2>
        <ul>
          <li>
            A valid citation number shows the section was given to the model. It
            does not prove every claim in the sentence is supported, so the
            section is always one click away.
          </li>
          <li>
            Keyword search finds nothing when no word matches. Semantic search
            always returns its nearest sections, related or not, and says so
            when no word matched.
          </li>
          <li>
            The chunking lab reports what each chunking retrieved for the
            questions you ran. It never declares one better.
          </li>
          {health && !health.generation && (
            <li>
              No model key is configured on this server, so explanations are
              sentences copied from your notes, and quizzes are unavailable.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
