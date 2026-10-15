import type { Metadata } from "next";
import { DocumentView } from "@/components/document-view";

// The manual's name is only known in the browser (manuals belong to its
// workspace), so the title stays general.
export const metadata: Metadata = {
  title: "Manual · Finder",
};

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentView id={id} />;
}
