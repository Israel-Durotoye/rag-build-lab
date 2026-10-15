import type { Metadata } from "next";
import { LabView } from "@/components/lab-view";

export const metadata: Metadata = {
  title: "Search modes · Finder",
  description:
    "One query through keyword, semantic and hybrid search with the same model filter, side by side, with the fusion arithmetic written out.",
};

export default function Page() {
  return <LabView />;
}
