import documents from "../corpus.json";
import { ingest } from "./retrieval";

// The bundled default is the official FUT Minna Mechatronics Engineering
// Students' Handbook 2021–2025, supplied by the workspace owner. Other demos'
// corpora are never bundled here.
export const handbook = ingest(documents);

const metadata = documents[0].metadata as Record<string, string>;

/** Default knowledge base identity shown across the interface. */
export const defaultSchool = {
  name: metadata.school ?? "Default school",
  shortName: "FUT Minna",
  department: metadata.department ?? "",
  documentTitle: documents[0].title,
  version: documents[0].version,
};
