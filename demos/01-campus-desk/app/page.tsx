import CampusDesk from "@/components/campus-desk";
import { defaultSchool, handbook } from "@/lib/handbook";
import { capabilities } from "@/lib/providers";

// Provider settings are read on the server, never exposed to the browser.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <CampusDesk
      sections={handbook.sources}
      corpusVersion={handbook.version}
      capabilities={capabilities()}
      school={defaultSchool}
    />
  );
}
