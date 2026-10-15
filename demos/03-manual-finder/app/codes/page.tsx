import type { Metadata } from "next";
import { CodesView } from "@/components/codes-view";

export const metadata: Metadata = {
  title: "Codes · Finder",
  description:
    "Every code in the manuals against every model, with the codes that differ marked.",
};

export default function Page() {
  return <CodesView />;
}
