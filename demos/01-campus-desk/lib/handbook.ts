import documents from "../corpus.json";
import { ingest } from "./retrieval";

// Only the public synthetic handbook is bundled, never other demos' corpora.
export const handbook = ingest(documents);
