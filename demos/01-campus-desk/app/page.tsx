import CampusDesk from "@/components/campus-desk";
import { capabilities, modelLabel } from "@/lib/providers";

// Provider settings are read on the server, never exposed to the browser.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <CampusDesk generation={capabilities().generation} model={modelLabel()} />
  );
}
