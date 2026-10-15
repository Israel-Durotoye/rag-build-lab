import type { Metadata } from "next";
import { LibraryView } from "@/components/library-view";

export const metadata: Metadata = {
  title: "Library · Finder",
  description:
    "The manuals Finder searches: the sample library and your own uploads, each passage tagged with the models it applies to.",
};

export default function Page() {
  return <LibraryView />;
}
