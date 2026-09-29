import { Suspense } from "react";
import { NotesView } from "@/components/notes-view";

export default function Page() {
  // NotesView reads ?doc= and ?section= from the address.
  return (
    <Suspense>
      <NotesView />
    </Suspense>
  );
}
