import type { Metadata } from "next";
import { ModelsView } from "@/components/models-view";

export const metadata: Metadata = {
  title: "Which model do I have? · Finder",
  description:
    "How the manuals tell look-alike models apart: identifying passages, revisions, and the codes and table rows that differ.",
};

export default function Page() {
  return <ModelsView />;
}
