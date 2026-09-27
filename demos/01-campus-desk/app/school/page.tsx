import type { Metadata } from "next";
import SchoolManager from "@/components/school-manager";
import { defaultSchool, handbook } from "@/lib/handbook";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your school — Campus Desk",
  description:
    "Choose the handbook Campus Desk searches: the built-in FUT Minna handbook, or your own school's knowledge base.",
};

export default function SchoolPage() {
  return (
    <SchoolManager
      defaultKb={{ ...defaultSchool, sectionCount: handbook.sources.length }}
    />
  );
}
