import documents from "../corpus.json";
import { ingest } from "./retrieval";

// Fixture corpus for tests and the retrieval evaluation: the FUT Minna
// Mechatronics Engineering Students' Handbook 2021–2025, shared with the
// Python baseline. The web app itself no longer bundles a default knowledge
// base — visitors add their own PDF or Word document in the browser.
export const handbook = ingest(documents);
