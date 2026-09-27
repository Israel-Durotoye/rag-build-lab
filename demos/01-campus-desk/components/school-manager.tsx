"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Download,
  FilePlus2,
  Landmark,
  Plus,
  ScissorsLineDashed,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  clearCustomSchool,
  getKbSnapshot,
  getServerKbSnapshot,
  parseSchoolDocuments,
  saveCustomSchool,
  setActiveKb,
  slugify,
  splitHandbookText,
  subscribeKb,
  SCHOOL_LIMITS,
  type ActiveKb,
  type CustomSchool,
} from "@/lib/school";
import type { HandbookDocument } from "@/lib/types";

export interface DefaultKbInfo {
  name: string;
  shortName: string;
  department: string;
  documentTitle: string;
  version: string;
  sectionCount: number;
}

interface EditorSection {
  key: number;
  title: string;
  location: string;
  text: string;
}

let sectionKey = 0;
const newSection = (
  partial: Partial<Omit<EditorSection, "key">> = {},
): EditorSection => ({
  key: ++sectionKey,
  title: "",
  location: "",
  text: "",
  ...partial,
});

function buildDocuments(
  name: string,
  title: string,
  version: string,
  sections: EditorSection[],
): HandbookDocument[] {
  const used = new Set<string>();
  const documentId = slugify(name) || "school-handbook";
  return parseSchoolDocuments([
    {
      id: documentId,
      title: title.trim() || `${name.trim()} student handbook`,
      version: version.trim() || "1",
      metadata: { school: name.trim(), addedBy: "student" },
      sections: sections.map((section, index) => {
        let id = slugify(section.title) || `section-${index + 1}`;
        while (used.has(id)) id = `${id.slice(0, 44)}-${index + 1}`;
        used.add(id);
        return {
          id,
          title: section.title.trim(),
          text: section.text.trim(),
          location: section.location.trim() || id,
        };
      }),
    },
  ]);
}

export default function SchoolManager({
  defaultKb,
}: {
  defaultKb: DefaultKbInfo;
}) {
  const kb = useSyncExternalStore(subscribeKb, getKbSnapshot, getServerKbSnapshot);
  const saved = kb.school;
  const active = kb.active;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [sections, setSections] = useState<EditorSection[]>([newSection()]);
  const [importText, setImportText] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const sectionCharacters = useMemo(
    () => sections.reduce((sum, section) => sum + section.text.length, 0),
    [sections],
  );

  function startEditor(from?: CustomSchool) {
    setEditing(true);
    setMessage(null);
    if (from) {
      const doc = from.documents[0];
      setName(from.name);
      setTitle(doc.title);
      setVersion(doc.version);
      setSections(
        doc.sections.map((section) =>
          newSection({
            title: section.title,
            location: section.location,
            text: section.text,
          }),
        ),
      );
    } else {
      setName("");
      setTitle("");
      setVersion("");
      setSections([newSection()]);
    }
  }

  function activate(kind: ActiveKb) {
    if (kind === "custom" && !saved) {
      startEditor();
      return;
    }
    setActiveKb(kind);
    setMessage({
      kind: "ok",
      text:
        kind === "custom"
          ? `Campus Desk now searches ${saved?.name}.`
          : `Campus Desk now searches the default ${defaultKb.shortName} handbook.`,
    });
  }

  function save() {
    const schoolName = name.trim();
    if (!schoolName) {
      setMessage({ kind: "error", text: "Give your school a name first." });
      return;
    }
    const filled = sections.filter(
      (section) => section.title.trim() && section.text.trim(),
    );
    if (!filled.length) {
      setMessage({
        kind: "error",
        text: "Add at least one section with a title and text.",
      });
      return;
    }
    try {
      const documents = buildDocuments(schoolName, title, version, filled);
      const school: CustomSchool = {
        name: schoolName.slice(0, SCHOOL_LIMITS.name),
        savedAt: new Date().toISOString(),
        documents,
      };
      if (!saveCustomSchool(school)) {
        setMessage({
          kind: "error",
          text: "This browser blocked local storage, so the knowledge base couldn’t be saved.",
        });
        return;
      }
      setActiveKb("custom");
      setEditing(false);
      setMessage({
        kind: "ok",
        text: `Saved ${documents[0].sections.length} sections. Campus Desk now searches ${schoolName}.`,
      });
    } catch (cause) {
      setMessage({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Couldn’t save this knowledge base.",
      });
    }
  }

  function remove() {
    clearCustomSchool();
    setEditing(false);
    setMessage({
      kind: "ok",
      text: `Removed. Campus Desk searches the default ${defaultKb.shortName} handbook again.`,
    });
  }

  function splitPasted() {
    const drafts = splitHandbookText(importText);
    if (!drafts.length) {
      setMessage({
        kind: "error",
        text: "Paste some handbook text first, then split it into sections.",
      });
      return;
    }
    setSections(
      drafts.map((draft) => newSection({ title: draft.title, text: draft.text })),
    );
    setImportText("");
    setMessage({
      kind: "ok",
      text: `Split into ${drafts.length} draft sections. Review the titles, then save.`,
    });
  }

  function importJson() {
    try {
      const parsed: unknown = JSON.parse(importText);
      const candidate =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? ((parsed as Record<string, unknown>).documents ?? [parsed])
          : parsed;
      const documents = parseSchoolDocuments(candidate);
      const doc = documents[0];
      const importedName =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).name === "string"
          ? ((parsed as Record<string, unknown>).name as string)
          : ((doc.metadata.school as string) ?? doc.title);
      setName(importedName);
      setTitle(doc.title);
      setVersion(doc.version);
      setSections(
        doc.sections.map((section) =>
          newSection({
            title: section.title,
            location: section.location,
            text: section.text,
          }),
        ),
      );
      setImportText("");
      setMessage({
        kind: "ok",
        text: `Imported ${doc.sections.length} sections from JSON. Review, then save.`,
      });
    } catch (cause) {
      setMessage({
        kind: "error",
        text:
          cause instanceof Error
            ? `Couldn’t import that JSON: ${cause.message}`
            : "Couldn’t import that JSON.",
      });
    }
  }

  function exportJson() {
    if (!saved) return;
    const blob = new Blob([JSON.stringify(saved, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(saved.name) || "school"}-knowledge-base.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function readFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(typeof reader.result === "string" ? reader.result : "");
      setMessage({
        kind: "ok",
        text: `Loaded “${file.name}”. Now split it into sections or import it as JSON.`,
      });
    };
    reader.readAsText(file);
  }

  return (
    <div className="kb-shell">
      <header className="kb-topbar">
        <Link className="text-button" href="/">
          <ArrowLeft size={15} /> Back to search
        </Link>
        <span className="school-badge">
          <ShieldCheck size={14} />
          <span className="badge-label">Knowledge bases stay on your device</span>
        </span>
      </header>
      <main className="kb-main">
        <span className="eyebrow">
          <span /> YOUR SCHOOL
        </span>
        <h1>
          Which handbook
          <br />
          <span>should Campus Desk search?</span>
        </h1>
        <p className="intro-description">
          The {defaultKb.shortName} handbook is built in. If you’re at another
          school, add your own handbook here — it’s stored in this browser and
          sent along only when you search.
        </p>

        {message ? (
          <p
            className={message.kind === "ok" ? "kb-message" : "kb-message kb-message-error"}
            role="status"
          >
            {message.text}
          </p>
        ) : null}

        <div className="kb-grid">
          <section
            className={`kb-card ${active === "default" ? "kb-card-active" : ""}`}
            aria-label="Default knowledge base"
          >
            <div className="kb-card-head">
              <span className="topic-icon">
                <Landmark />
              </span>
              {active === "default" ? (
                <span className="kb-pill">
                  <Check size={12} /> In use
                </span>
              ) : null}
            </div>
            <h2>{defaultKb.name}</h2>
            <p className="kb-card-detail">
              {defaultKb.documentTitle} · {defaultKb.department}.{" "}
              {defaultKb.sectionCount} sections, version {defaultKb.version}.
              Bundled with Campus Desk as the default.
            </p>
            <div className="kb-actions">
              <button
                className="primary-button"
                disabled={active === "default"}
                onClick={() => activate("default")}
              >
                {active === "default" ? "Currently in use" : "Use this handbook"}
                <Check size={15} />
              </button>
            </div>
          </section>

          <section
            className={`kb-card ${active === "custom" ? "kb-card-active" : ""}`}
            aria-label="Your school's knowledge base"
          >
            <div className="kb-card-head">
              <span className="topic-icon">
                <BookOpen />
              </span>
              {active === "custom" && saved ? (
                <span className="kb-pill">
                  <Check size={12} /> In use
                </span>
              ) : null}
            </div>
            <h2>{saved ? saved.name : "Another school?"}</h2>
            <p className="kb-card-detail">
              {saved
                ? `${saved.documents[0].title} · ${saved.documents[0].sections.length} sections, version ${saved.documents[0].version}. Saved in this browser${saved.savedAt ? ` on ${new Date(saved.savedAt).toLocaleDateString()}` : ""}.`
                : "Paste your school’s handbook, split it into sections, and Campus Desk will search it with the same citations and honest limits."}
            </p>
            <div className="kb-actions">
              {saved ? (
                <>
                  <button
                    className="primary-button"
                    disabled={active === "custom"}
                    onClick={() => activate("custom")}
                  >
                    {active === "custom" ? "Currently in use" : "Use this handbook"}
                    <Check size={15} />
                  </button>
                  <button className="text-button" onClick={() => startEditor(saved)}>
                    Edit sections <ArrowRight size={14} />
                  </button>
                  <button className="text-button" onClick={exportJson}>
                    <Download size={14} /> Export JSON
                  </button>
                  <button className="text-button kb-danger" onClick={remove}>
                    <Trash2 size={14} /> Remove
                  </button>
                </>
              ) : (
                <button className="primary-button" onClick={() => startEditor()}>
                  Add my school’s handbook <FilePlus2 size={15} />
                </button>
              )}
            </div>
          </section>
        </div>

        {editing ? (
          <section className="kb-editor" aria-label="Knowledge base editor">
            <div className="section-heading">
              <h2>{saved ? "Edit your knowledge base" : "Add your school’s handbook"}</h2>
              <span>
                {sections.length} {sections.length === 1 ? "section" : "sections"}{" "}
                · {sectionCharacters.toLocaleString()} characters
              </span>
            </div>

            <div className="kb-field-row">
              <label className="kb-field">
                School name
                <input
                  value={name}
                  maxLength={SCHOOL_LIMITS.name}
                  placeholder="e.g. University of Lagos"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="kb-field">
                Handbook title
                <input
                  value={title}
                  maxLength={SCHOOL_LIMITS.title}
                  placeholder="e.g. Students’ Handbook"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="kb-field kb-field-small">
                Version
                <input
                  value={version}
                  maxLength={SCHOOL_LIMITS.version}
                  placeholder="e.g. 2024"
                  onChange={(event) => setVersion(event.target.value)}
                />
              </label>
            </div>

            <div className="kb-import">
              <label className="kb-field">
                Paste handbook text or a JSON export
                <textarea
                  rows={6}
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  placeholder={
                    "Paste chapters here — headings like “2.7 Grading System” become section titles.\nOr paste a JSON export from another browser."
                  }
                />
              </label>
              <div className="kb-import-actions">
                <button className="text-button" onClick={splitPasted}>
                  <ScissorsLineDashed size={14} /> Split text into sections
                </button>
                <button className="text-button" onClick={importJson}>
                  <Upload size={14} /> Import as JSON
                </button>
                <button
                  className="text-button"
                  onClick={() => fileInput.current?.click()}
                >
                  <FilePlus2 size={14} /> Load a .txt / .json file
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".txt,.md,.json,text/plain,application/json"
                  hidden
                  onChange={(event) => {
                    readFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>

            <div className="kb-sections">
              {sections.map((section, index) => (
                <article className="kb-section-item" key={section.key}>
                  <div className="kb-section-head">
                    <span className="source-number">
                      {(index + 1).toString().padStart(2, "0")}
                    </span>
                    <input
                      value={section.title}
                      maxLength={SCHOOL_LIMITS.title}
                      placeholder="Section title, e.g. Grading system"
                      aria-label={`Section ${index + 1} title`}
                      onChange={(event) =>
                        setSections((current) =>
                          current.map((item) =>
                            item.key === section.key
                              ? { ...item, title: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <input
                      className="kb-location"
                      value={section.location}
                      maxLength={SCHOOL_LIMITS.location}
                      placeholder="e.g. §2.7"
                      aria-label={`Section ${index + 1} location`}
                      onChange={(event) =>
                        setSections((current) =>
                          current.map((item) =>
                            item.key === section.key
                              ? { ...item, location: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <button
                      className="icon-button"
                      aria-label={`Remove section ${index + 1}`}
                      onClick={() =>
                        setSections((current) =>
                          current.length > 1
                            ? current.filter((item) => item.key !== section.key)
                            : [newSection()],
                        )
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={section.text}
                    maxLength={SCHOOL_LIMITS.sectionText}
                    placeholder="The exact handbook wording for this section…"
                    aria-label={`Section ${index + 1} text`}
                    onChange={(event) =>
                      setSections((current) =>
                        current.map((item) =>
                          item.key === section.key
                            ? { ...item, text: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </article>
              ))}
              <button
                className="text-button"
                onClick={() => setSections((current) => [...current, newSection()])}
              >
                <Plus size={14} /> Add a section
              </button>
            </div>

            <div className="kb-editor-footer">
              <button className="primary-button" onClick={save}>
                Save & use this handbook <Check size={15} />
              </button>
              <button className="text-button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </section>
        ) : null}

        <footer className="page-footer">
          <span>
            <ShieldCheck size={15} /> Private by default.
          </span>
          <p>
            Your knowledge base is kept in this browser’s storage and sent only
            to this app’s search endpoint when you ask a question.
          </p>
          <Link href="/" className="text-button">
            Ask the handbook <ArrowRight size={13} />
          </Link>
        </footer>
      </main>
    </div>
  );
}
