"use client";

import { ArrowRight, BookOpen, Layers, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRag } from "./rag-provider";
import { LayerNav, TurnPicker, formatMs } from "./ui";

export function HowItWorksView() {
  const { inspected, documents } = useRag();
  const done = inspected?.done;
  return (
    <div className="layer">
      <header className="layer-intro">
        <LayerNav />
        <span className="eyebrow">How it works</span>
        <h1>The assistant is never trained on your documents.</h1>
        <p>
          It reads them at the moment you ask. This is called
          retrieval-augmented generation: the documents are searched, the best
          passages are placed into the assistant&rsquo;s prompt, and the answer
          is written from those passages alone, with citations. Each step below
          has its own page showing exactly what happened for a question.
        </p>
      </header>
      <TurnPicker />

      <ol className="flow-cards">
        <li className="card">
          <span className="flow-icon" aria-hidden>
            <BookOpen size={18} />
          </span>
          <span className="eyebrow">Before any question</span>
          <h3>Documents</h3>
          <p>
            Each file is read (including scanned pages), split into short
            passages that keep their page numbers, and indexed twice: by keyword
            and by meaning.
          </p>
          <Link href="/library" className="link">
            {documents?.length
              ? `${documents.length} in the library`
              : "Open the library"}{" "}
            <ArrowRight size={13} aria-hidden />
          </Link>
        </li>
        <li className="card">
          <span className="flow-icon" aria-hidden>
            <Search size={18} />
          </span>
          <span className="eyebrow">Step 1</span>
          <h3>Retrieval</h3>
          <p>
            The question is searched against every passage. Keyword matching and
            meaning matching each rank the passages; the two rankings are merged
            and the top few are kept.
          </p>
          <Link href="/retrieval" className="link">
            {inspected?.retrieval
              ? `${inspected.retrieval.selected.length} passages chosen in ${formatMs(inspected.retrieval.ms)}`
              : "See the search"}{" "}
            <ArrowRight size={13} aria-hidden />
          </Link>
        </li>
        <li className="card">
          <span className="flow-icon" aria-hidden>
            <Layers size={18} />
          </span>
          <span className="eyebrow">Step 2</span>
          <h3>Augmentation</h3>
          <p>
            The chosen passages are numbered and placed into the prompt with the
            question and the instructions from Settings. This is all the
            assistant gets to work with.
          </p>
          <Link href="/augmentation" className="link">
            {inspected?.augmentation
              ? `A prompt of about ${inspected.augmentation.stats.estimatedTokens.toLocaleString()} tokens`
              : "See the prompt"}{" "}
            <ArrowRight size={13} aria-hidden />
          </Link>
        </li>
        <li className="card">
          <span className="flow-icon" aria-hidden>
            <Sparkles size={18} />
          </span>
          <span className="eyebrow">Step 3</span>
          <h3>Generation</h3>
          <p>
            The assistant writes the answer, citing passage numbers. Every
            citation is checked against the passages before the answer is shown.
          </p>
          <Link href="/generation" className="link">
            {done
              ? `${done.citations.length} citations checked in ${formatMs(done.timings.generationMs)}`
              : "See the answer being written"}{" "}
            <ArrowRight size={13} aria-hidden />
          </Link>
        </li>
      </ol>

      {!inspected && (
        <p className="muted">
          Ask a question on the{" "}
          <Link href="/ask" className="link">
            Ask page
          </Link>{" "}
          and the three step pages will fill in with what happened.
        </p>
      )}
    </div>
  );
}
