import type { Metadata } from "next";
import { InspectView } from "@/components/inspect-view";

export const metadata: Metadata = {
  title: "Inspect · Finder",
  description:
    "Every step of one answer: the question as read, the model filter, the three rankings and their fusion, the context and the exact prompt.",
};

export default function Page() {
  return <InspectView />;
}
