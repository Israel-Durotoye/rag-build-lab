import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";

export const metadata: Metadata = {
  title: "Settings · Finder",
  description:
    "How answers are written and passages are found for this browser's workspace, and the theme.",
};

export default function Page() {
  return <SettingsView />;
}
