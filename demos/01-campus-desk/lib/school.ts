import type { HandbookDocument, Source } from "./types";

/**
 * Shared rules for user-added school knowledge bases. This module must stay
 * client-safe (no Node imports): the browser uses it to validate and store a
 * school, and the search route re-validates the same shape on the server.
 */
export const SCHOOL_LIMITS = {
  documents: 3,
  sections: 200,
  name: 120,
  title: 200,
  version: 40,
  location: 120,
  sectionText: 8000,
  totalCharacters: 900_000,
} as const;

const DOCUMENT_FIELDS = ["id", "title", "version", "metadata", "sections"];
const SECTION_FIELDS = ["id", "title", "text", "location"];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function fail(message: string): never {
  throw new Error(message);
}

function cleanString(
  value: unknown,
  field: string,
  max: number,
  fallback?: string,
): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string") fail(`${field} must be text.`);
  const text = value.trim();
  if (!text) {
    if (fallback !== undefined) return fallback;
    fail(`${field} must not be empty.`);
  }
  if (text.length > max) fail(`${field} must stay under ${max} characters.`);
  return text;
}

/** Validate untrusted input into handbook documents, or throw a plain message. */
export function parseSchoolDocuments(value: unknown): HandbookDocument[] {
  if (!Array.isArray(value) || !value.length)
    fail("Provide at least one handbook document.");
  if (value.length > SCHOOL_LIMITS.documents)
    fail(`A knowledge base may hold at most ${SCHOOL_LIMITS.documents} documents.`);
  if (JSON.stringify(value).length > SCHOOL_LIMITS.totalCharacters)
    fail("This knowledge base is too large. Trim long sections and try again.");
  const documents: HandbookDocument[] = [];
  const documentIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      fail("Each handbook document must be an object.");
    const raw = item as Record<string, unknown>;
    const unknownField = Object.keys(raw).find(
      (key) => !DOCUMENT_FIELDS.includes(key),
    );
    if (unknownField) fail(`Unsupported document field “${unknownField}”.`);
    const id = cleanString(raw.id, "Document ID", 64).toLowerCase();
    if (!ID_PATTERN.test(id))
      fail("Document IDs may only use lowercase letters, numbers and hyphens.");
    if (documentIds.has(id)) fail(`Duplicate document ID “${id}”.`);
    documentIds.add(id);
    let metadata: Record<string, unknown> = {};
    if (raw.metadata !== undefined) {
      if (!raw.metadata || typeof raw.metadata !== "object" || Array.isArray(raw.metadata))
        fail("Document metadata must be an object.");
      metadata = { ...(raw.metadata as Record<string, unknown>) };
      // The public search index never accepts tenant-scoped documents.
      if (metadata.tenant != null)
        fail("Tenant documents are not supported in Campus Desk.");
    }
    if (!Array.isArray(raw.sections) || !raw.sections.length)
      fail("Each handbook document needs at least one section.");
    if (raw.sections.length > SCHOOL_LIMITS.sections)
      fail(`A document may hold at most ${SCHOOL_LIMITS.sections} sections.`);
    const sectionIds = new Set<string>();
    const sections = raw.sections.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        fail(`Section ${index + 1} must be an object.`);
      const section = entry as Record<string, unknown>;
      const unknownSectionField = Object.keys(section).find(
        (key) => !SECTION_FIELDS.includes(key),
      );
      if (unknownSectionField)
        fail(`Unsupported section field “${unknownSectionField}”.`);
      const sectionId = cleanString(
        section.id,
        `Section ${index + 1} ID`,
        64,
      ).toLowerCase();
      if (!ID_PATTERN.test(sectionId))
        fail("Section IDs may only use lowercase letters, numbers and hyphens.");
      if (sectionIds.has(sectionId)) fail(`Duplicate section ID “${sectionId}”.`);
      sectionIds.add(sectionId);
      const title = cleanString(
        section.title,
        `Section ${index + 1} title`,
        SCHOOL_LIMITS.title,
      );
      const text = cleanString(
        section.text,
        `Section “${title}” text`,
        SCHOOL_LIMITS.sectionText,
      );
      const location = cleanString(
        section.location,
        `Section “${title}” location`,
        SCHOOL_LIMITS.location,
        sectionId,
      );
      return { id: sectionId, title, text, location };
    });
    documents.push({
      id,
      title: cleanString(raw.title, "Handbook title", SCHOOL_LIMITS.title),
      version: cleanString(raw.version, "Handbook version", SCHOOL_LIMITS.version, "1"),
      metadata,
      sections,
    });
  }
  return documents;
}

/**
 * Section list for browsing a knowledge base in the client. IDs and citation
 * labels match the server's ingestion; content hashes are only computed
 * server-side, so they stay empty here and the UI hides them.
 */
export function sectionsFromDocuments(documents: HandbookDocument[]): Source[] {
  return documents.flatMap((doc) =>
    doc.sections.map((section) => ({
      id: `${doc.id}:${section.id}:0`,
      documentId: doc.id,
      documentTitle: doc.title,
      title: section.title,
      text: section.text,
      location: section.location,
      section: section.id,
      version: doc.version,
      contentHash: "",
      citationLabel: `${doc.id} · ${section.title} · ${section.location} · v${doc.version}`,
    })),
  );
}

export interface CustomSchool {
  name: string;
  savedAt: string;
  documents: HandbookDocument[];
}

const SCHOOL_KEY = "campus-desk.custom-school.v1";
const ACTIVE_KEY = "campus-desk.active-kb.v1";

export type ActiveKb = "default" | "custom";

export interface KbSnapshot {
  active: ActiveKb;
  school: CustomSchool | null;
}

const DEFAULT_SNAPSHOT: KbSnapshot = { active: "default", school: null };
let snapshot: KbSnapshot = DEFAULT_SNAPSHOT;
let snapshotRaw: string | null = null;
const listeners = new Set<() => void>();

function readRaw(): string {
  try {
    return `${window.localStorage.getItem(ACTIVE_KEY) ?? ""}\u0000${window.localStorage.getItem(SCHOOL_KEY) ?? ""}`;
  } catch {
    return "";
  }
}

function emitKbChange(): void {
  for (const listener of listeners) listener();
}

/** Store hooks for useSyncExternalStore: stable snapshots of the active KB. */
export function subscribeKb(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getKbSnapshot(): KbSnapshot {
  const raw = readRaw();
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    const school = loadCustomSchool();
    snapshot = { active: school ? loadActiveKb() : "default", school };
  }
  return snapshot;
}

export function getServerKbSnapshot(): KbSnapshot {
  return DEFAULT_SNAPSHOT;
}

/** Browser-only storage. Every call tolerates blocked or cleared storage. */
export function loadCustomSchool(): CustomSchool | null {
  try {
    const raw = window.localStorage.getItem(SCHOOL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const documents = parseSchoolDocuments(parsed.documents);
    const name =
      typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim().slice(0, SCHOOL_LIMITS.name)
        : documents[0].title;
    return {
      name,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
      documents,
    };
  } catch {
    return null;
  }
}

export function saveCustomSchool(school: CustomSchool): boolean {
  try {
    window.localStorage.setItem(SCHOOL_KEY, JSON.stringify(school));
    emitKbChange();
    return true;
  } catch {
    return false;
  }
}

export function clearCustomSchool(): void {
  try {
    window.localStorage.removeItem(SCHOOL_KEY);
    window.localStorage.setItem(ACTIVE_KEY, "default");
    emitKbChange();
  } catch {
    /* storage unavailable */
  }
}

export function loadActiveKb(): ActiveKb {
  try {
    return window.localStorage.getItem(ACTIVE_KEY) === "custom" &&
      loadCustomSchool()
      ? "custom"
      : "default";
  } catch {
    return "default";
  }
}

export function setActiveKb(kind: ActiveKb): boolean {
  try {
    window.localStorage.setItem(ACTIVE_KEY, kind);
    emitKbChange();
    return true;
  } catch {
    return false;
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export interface DraftSection {
  title: string;
  text: string;
}

function isHeadingLine(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 90) return false;
  if (/^#{1,6}\s+\S/.test(text)) return true;
  if (
    /^\d+(\.\d+)*[.)]?\s+\S/.test(text) &&
    text.length <= 80 &&
    !/[.:;,]$/.test(text)
  )
    return true;
  const letters = text.replace(/[^A-Za-z]/g, "");
  return (
    letters.length >= 4 &&
    letters === letters.toUpperCase() &&
    text.split(/\s+/).length <= 10
  );
}

function chunkLongText(title: string, text: string): DraftSection[] {
  const limit = SCHOOL_LIMITS.sectionText - 1000;
  if (text.length <= limit) return [{ title, text }];
  const parts: DraftSection[] = [];
  const words = text.split(/\s+/);
  let current: string[] = [];
  let size = 0;
  for (const word of words) {
    if (size + word.length + 1 > limit && current.length) {
      parts.push({ title, text: current.join(" ") });
      current = [];
      size = 0;
    }
    current.push(word);
    size += word.length + 1;
  }
  if (current.length) parts.push({ title, text: current.join(" ") });
  return parts.map((part, index) =>
    parts.length > 1
      ? { ...part, title: `${part.title} (part ${index + 1})` }
      : part,
  );
}

/**
 * Split pasted handbook text into draft sections. Headings are markdown
 * hashes, numbered clauses (e.g. “2.7 Grading System”) or short ALL-CAPS
 * lines; without headings, paragraphs are grouped into readable sections.
 */
export function splitHandbookText(raw: string): DraftSection[] {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const drafts: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    if (isHeadingLine(line)) {
      if (current) drafts.push(current);
      current = { title: line.trim().replace(/^#{1,6}\s+/, ""), body: [] };
    } else if (current) {
      current.body.push(line);
    } else if (line.trim()) {
      current = { title: "", body: [line] };
    }
  }
  if (current) drafts.push(current);

  let sections = drafts
    .map((draft, index) => ({
      title: draft.title || `Section ${index + 1}`,
      text: draft.body.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    }))
    .filter((draft) => draft.text);

  if (sections.length <= 1) {
    const paragraphs = raw
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    const grouped: DraftSection[] = [];
    let bucket: string[] = [];
    let size = 0;
    for (const paragraph of paragraphs) {
      if (size + paragraph.length > 1500 && bucket.length) {
        grouped.push({ title: "", text: bucket.join("\n\n") });
        bucket = [];
        size = 0;
      }
      bucket.push(paragraph);
      size += paragraph.length;
    }
    if (bucket.length) grouped.push({ title: "", text: bucket.join("\n\n") });
    sections = grouped.map((section, index) => ({
      title:
        section.text.split(/[.\n]/)[0].trim().slice(0, 60) ||
        `Section ${index + 1}`,
      text: section.text,
    }));
  }

  return sections
    .flatMap((section) => chunkLongText(section.title, section.text))
    .slice(0, SCHOOL_LIMITS.sections);
}
