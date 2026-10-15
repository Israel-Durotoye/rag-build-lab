import type { Metadata } from "next";
import { EvaluateView } from "@/components/evaluate-view";

export const metadata: Metadata = {
  title: "Evaluation · Finder",
  description:
    "The labelled queries through keyword, semantic and hybrid search: hits, ranks, wrong-model and look-alike passages, and clarifications, as each run found them.",
};

export default function Page() {
  return <EvaluateView />;
}
