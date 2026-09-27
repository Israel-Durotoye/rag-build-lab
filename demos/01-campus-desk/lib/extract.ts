import {
  SCHOOL_LIMITS,
  chunkLongText,
  parseSchoolDocuments,
  slugify,
  splitHandbookText,
} from "./school";
import type { HandbookDocument } from "./types";

/**
 * In-browser document extraction. The heavy libraries (pdf.js, tesseract.js,
 * mammoth) are imported on demand inside the functions that need them, so they
 * never join the initial bundle, never run on the server, and this module's
 * pure helpers stay importable from Node tests.
 */

export interface ExtractProgress {
  stage: "reading" | "text" | "ocr" | "sections";
  done?: number;
  total?: number;
}

export interface PageText {
  page: number;
  text: string;
  ocr: boolean;
}

export interface PageSection {
  title: string;
  text: string;
  location: string;
}

export interface ExtractedDocument {
  name: string;
  format: "pdf" | "word" | "text";
  pages: number;
  ocrPages: number;
  /** True when image analysis was needed but failed (e.g. offline). */
  ocrFailed: boolean;
  characters: number;
  truncated: boolean;
  documents: HandbookDocument[];
}

/** A page counts as "has a text layer" above this many non-space characters. */
const TEXT_LAYER_THRESHOLD = 40;
/** Image analysis stops after this many pages to keep uploads bounded. */
const OCR_PAGE_LIMIT = 120;
/** Target size of one section before the next page starts a new one. */
const SECTION_TARGET = 2400;

function sectionTitle(text: string, start: number, end: number): string {
  for (const line of text.split("\n")) {
    const clean = line.replace(/\s+/g, " ").trim();
    if (clean.length >= 4 && clean.length <= 80) return clean;
    if (clean.length > 80) break;
  }
  return start === end ? `Page ${start}` : `Pages ${start}–${end}`;
}

/** Group extracted pages into titled, page-cited sections. Pure. */
export function sectionsFromPages(pages: PageText[]): PageSection[] {
  const cleaned = pages
    .map((page) => ({
      ...page,
      text: page.text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    }))
    .filter((page) => page.text);
  const sections: PageSection[] = [];
  let bucket: {
    start: number;
    end: number;
    parts: string[];
    size: number;
  } | null = null;
  const flush = () => {
    if (!bucket) return;
    const text = bucket.parts.join("\n\n").trim();
    if (text) {
      const location =
        bucket.start === bucket.end
          ? `p. ${bucket.start}`
          : `p. ${bucket.start}–${bucket.end}`;
      const title = sectionTitle(text, bucket.start, bucket.end);
      for (const part of chunkLongText(title, text))
        sections.push({ title: part.title, text: part.text, location });
    }
    bucket = null;
  };
  for (const page of cleaned) {
    if (bucket && bucket.size + page.text.length > SECTION_TARGET) flush();
    if (!bucket)
      bucket = { start: page.page, end: page.page, parts: [], size: 0 };
    bucket.parts.push(page.text);
    bucket.end = page.page;
    bucket.size += page.text.length;
  }
  flush();
  return sections;
}

/** Enforce the shared knowledge-base limits, reporting whether content was cut. */
export function fitSections(sections: PageSection[]): {
  sections: PageSection[];
  truncated: boolean;
} {
  const kept: PageSection[] = [];
  let total = 0;
  // Headroom for JSON structure, titles and locations around the raw text.
  const budget = SCHOOL_LIMITS.totalCharacters - 40_000;
  for (const section of sections) {
    if (
      kept.length >= SCHOOL_LIMITS.sections ||
      total + section.text.length > budget
    )
      return { sections: kept, truncated: true };
    kept.push(section);
    total += section.text.length;
  }
  return { sections: kept, truncated: false };
}

/** Build a validated handbook document from extracted sections. Pure. */
export function buildDocuments(
  name: string,
  metadata: Record<string, unknown>,
  sections: PageSection[],
): HandbookDocument[] {
  const documentId = slugify(name) || "document";
  const seen = new Map<string, number>();
  const docSections = sections.map((section, index) => {
    let id =
      slugify(section.title).slice(0, 56).replace(/-+$/, "") ||
      `part-${index + 1}`;
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count > 1) id = `${id}-${count}`;
    return {
      id,
      title: section.title,
      text: section.text,
      location: section.location || `part ${index + 1}`,
    };
  });
  return parseSchoolDocuments([
    {
      id: documentId,
      title: name.slice(0, SCHOOL_LIMITS.title),
      version: "1",
      metadata,
      sections: docSections,
    },
  ]);
}

async function pagesFromPdf(
  file: File,
  onProgress: (progress: ExtractProgress) => void,
): Promise<{
  pages: PageText[];
  pageCount: number;
  ocrPages: number;
  ocrFailed: boolean;
  ocrSkipped: number;
}> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (cause) {
    await loadingTask.destroy();
    if ((cause as { name?: string })?.name === "PasswordException")
      throw new Error(
        "This PDF is password-protected. Remove the password and try again.",
      );
    throw new Error("This PDF could not be opened. Try re-exporting it.");
  }
  const pages: PageText[] = [];
  const imagePages: number[] = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      onProgress({ stage: "text", done: number, total: pdf.numPages });
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items)
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      text = text.trim();
      if (text.replace(/\s/g, "").length >= TEXT_LAYER_THRESHOLD)
        pages.push({ page: number, text, ocr: false });
      else imagePages.push(number);
    }

    let ocrCount = 0;
    let ocrFailed = false;
    const ocrTargets = imagePages.slice(0, OCR_PAGE_LIMIT);
    if (ocrTargets.length) {
      try {
        const { createWorker } = await import("tesseract.js");
        // Worker, WASM core and English data come from the version-pinned
        // tesseract.js CDN defaults; nothing leaves the browser.
        const worker = await createWorker("eng");
        try {
          for (let index = 0; index < ocrTargets.length; index++) {
            onProgress({
              stage: "ocr",
              done: index + 1,
              total: ocrTargets.length,
            });
            const page = await pdf.getPage(ocrTargets[index]);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const context = canvas.getContext("2d", {
              willReadFrequently: true,
            });
            if (!context) continue;
            await page.render({ canvas, canvasContext: context, viewport })
              .promise;
            const result = await worker.recognize(canvas);
            const text = result.data.text.trim();
            if (text.replace(/\s/g, "").length >= 20) {
              pages.push({ page: ocrTargets[index], text, ocr: true });
              ocrCount++;
            }
          }
        } finally {
          await worker.terminate();
        }
      } catch {
        // Keep whatever the text layer produced; the caller reports this.
        ocrFailed = true;
      }
    }
    pages.sort((a, b) => a.page - b.page);
    return {
      pages,
      pageCount: pdf.numPages,
      ocrPages: ocrCount,
      ocrFailed,
      ocrSkipped: Math.max(0, imagePages.length - OCR_PAGE_LIMIT),
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function textFromWord(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  return result.value;
}

/** Extract a user-supplied file into a validated, searchable document. */
export async function extractFile(
  file: File,
  onProgress: (progress: ExtractProgress) => void,
): Promise<ExtractedDocument> {
  const lower = file.name.toLowerCase();
  const name = file.name.replace(/\.[a-z0-9]+$/i, "").trim() || "Document";
  if (file.size > 40 * 1024 * 1024)
    throw new Error(
      "This file is over 40 MB. Export a smaller version and try again.",
    );
  onProgress({ stage: "reading" });

  let sections: PageSection[];
  let format: ExtractedDocument["format"];
  let pages = 0;
  let ocrPages = 0;
  let ocrFailed = false;
  let truncatedByOcrLimit = false;

  if (lower.endsWith(".pdf")) {
    const result = await pagesFromPdf(file, onProgress);
    if (!result.pages.length)
      throw new Error(
        result.ocrFailed
          ? "This PDF has no text layer and image analysis could not run. Check your internet connection and try again."
          : "No readable text was found in this PDF.",
      );
    format = "pdf";
    pages = result.pageCount;
    ocrPages = result.ocrPages;
    ocrFailed = result.ocrFailed;
    truncatedByOcrLimit = result.ocrSkipped > 0;
    onProgress({ stage: "sections" });
    sections = sectionsFromPages(result.pages);
  } else if (lower.endsWith(".docx")) {
    format = "word";
    const raw = await textFromWord(file);
    onProgress({ stage: "sections" });
    sections = splitHandbookText(raw).map((section, index) => ({
      ...section,
      location: `part ${index + 1}`,
    }));
  } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    format = "text";
    const raw = await file.text();
    onProgress({ stage: "sections" });
    sections = splitHandbookText(raw).map((section, index) => ({
      ...section,
      location: `part ${index + 1}`,
    }));
  } else if (lower.endsWith(".doc")) {
    throw new Error(
      "Legacy .doc files aren't supported. Save it as .docx or PDF first.",
    );
  } else {
    throw new Error("Add a PDF (.pdf) or Word (.docx) file.");
  }

  const fit = fitSections(sections);
  if (!fit.sections.length)
    throw new Error("No readable text was found in this file.");
  const characters = fit.sections.reduce(
    (sum, section) => sum + section.text.length,
    0,
  );
  const truncated = fit.truncated || truncatedByOcrLimit;
  const documents = buildDocuments(
    name,
    {
      source: "upload",
      format,
      pages,
      ocrPages,
      ocrFailed,
      truncated,
      characters,
      addedAt: new Date().toISOString(),
    },
    fit.sections,
  );
  return {
    name,
    format,
    pages,
    ocrPages,
    ocrFailed,
    characters,
    truncated,
    documents,
  };
}
