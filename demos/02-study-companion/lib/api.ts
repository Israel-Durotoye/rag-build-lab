import type {
  AskEvent,
  AskOptions,
  CompareResult,
  ContextOptions,
  DocumentDetail,
  DocumentSummary,
  Overview,
  PracticeProgress,
  PracticeRequest,
  PracticeSet,
  PracticeSummary,
  Prefs,
  RetrievalMode,
  SampleInfo,
  SettingsResponse,
  UploadProgress,
} from "./types";
import { API_VERSION_HEADER, backendProblem } from "./contract";

/**
 * Browser-side client for the Python backend. Next.js proxies /api/* to it.
 * Every call carries this browser's workspace ID, which keeps one student's
 * notes out of another's searches.
 */

const WORKSPACE_KEY = "study-companion.workspace.v1";
let memoryWorkspace: string | null = null;

function newWorkspaceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function workspaceId(): string {
  try {
    const stored = window.localStorage.getItem(WORKSPACE_KEY);
    if (stored && /^[a-f0-9]{32}$/.test(stored)) return stored;
    const created = newWorkspaceId();
    window.localStorage.setItem(WORKSPACE_KEY, created);
    return created;
  } catch {
    // Storage blocked (private mode): keep one ID for this page's lifetime.
    memoryWorkspace ??= newWorkspaceId();
    return memoryWorkspace;
  }
}

export class ApiError extends Error {}

const OFFLINE =
  "The Study Companion backend isn't reachable. It may still be starting; try again in a moment.";
const INCOMPATIBLE =
  "The Study Companion backend is out of date. Deploy the backend that belongs with this frontend.";

/**
 * A hosted backend's edge (a Hugging Face Space, for instance) now and then
 * answers 502 before the request reaches the backend at all. Such a reply has
 * no contract header, so it is safe to send the same request again, uploads
 * and questions included: nothing was processed. Two more attempts, spaced
 * out, take a one-in-ten failure down to one in a thousand.
 */
const RETRY_DELAYS_MS = [400, 1200];

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) return abort();
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      abort();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const retry = attempt < RETRY_DELAYS_MS.length;
    let response: Response;
    try {
      response = await fetch(path, {
        ...init,
        headers: { ...init.headers, "X-Workspace-Id": workspaceId() },
        cache: "no-store",
      });
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError") throw cause;
      if (!retry) throw new ApiError(OFFLINE);
      await wait(RETRY_DELAYS_MS[attempt], init.signal);
      continue;
    }
    const problem = backendProblem({
      ok: response.ok,
      versionHeader: response.headers.get(API_VERSION_HEADER),
    });
    if (problem === "unreachable" && retry) {
      await wait(RETRY_DELAYS_MS[attempt], init.signal);
      continue;
    }
    if (problem === "incompatible") throw new ApiError(INCOMPATIBLE);
    if (problem === "unreachable") throw new ApiError(OFFLINE);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new ApiError(
        body?.error ||
          (response.status >= 500
            ? OFFLINE
            : `Request failed (${response.status}).`),
      );
    }
    return response;
  }
}

function json(body: unknown, init: RequestInit = {}): RequestInit {
  return {
    method: "POST",
    ...init,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Parse a newline-delimited JSON stream, yielding one object per line. */
export async function* readNdjson<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) if (line.trim()) yield JSON.parse(line) as T;
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const response = await request("/api/documents");
  return ((await response.json()) as { documents: DocumentSummary[] })
    .documents;
}

export async function getDocument(id: string): Promise<DocumentDetail> {
  const response = await request(`/api/documents/${encodeURIComponent(id)}`);
  return (await response.json()) as DocumentDetail;
}

export async function deleteDocument(id: string): Promise<void> {
  await request(`/api/documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function writeOverview(id: string): Promise<Overview> {
  const response = await request(
    `/api/documents/${encodeURIComponent(id)}/overview`,
    { method: "POST" },
  );
  return (await response.json()) as Overview;
}

export async function getSample(): Promise<SampleInfo> {
  const response = await request("/api/sample");
  return (await response.json()) as SampleInfo;
}

export async function loadSample(): Promise<DocumentSummary[]> {
  const response = await request("/api/sample", { method: "POST" });
  return ((await response.json()) as { documents: DocumentSummary[] })
    .documents;
}

export async function getSettings(): Promise<SettingsResponse> {
  const response = await request("/api/settings");
  return (await response.json()) as SettingsResponse;
}

export async function saveSettings(
  patch: Partial<Prefs>,
): Promise<SettingsResponse> {
  const response = await request(
    "/api/settings",
    json(patch, { method: "PUT" }),
  );
  return (await response.json()) as SettingsResponse;
}

type UploadEvent =
  | ({ type: "progress" } & Omit<UploadProgress, "fileName">)
  | { type: "done"; document: DocumentSummary }
  | { type: "error"; error: string };

export async function uploadDocument(
  file: File,
  onProgress: (progress: Omit<UploadProgress, "index" | "count">) => void,
): Promise<DocumentSummary> {
  const form = new FormData();
  form.append("file", file);
  const response = await request("/api/documents", {
    method: "POST",
    body: form,
  });
  if (!response.body) throw new ApiError(OFFLINE);
  for await (const event of readNdjson<UploadEvent>(response.body)) {
    if (event.type === "error") throw new ApiError(event.error);
    if (event.type === "done") return event.document;
    onProgress({
      fileName: file.name,
      stage: event.stage,
      done: event.done,
      total: event.total,
    });
  }
  throw new ApiError(
    "The upload ended before the notes were ready. Try again.",
  );
}

export interface AskRequest extends AskOptions {
  message: string;
  /** Earlier questions of the current topic. Answers are never sent. */
  earlier: string[];
  followUp: boolean | "auto";
}

export async function* ask(
  body: AskRequest,
  signal: AbortSignal,
): AsyncGenerator<AskEvent> {
  const response = await request("/api/ask", json(body, { signal }));
  if (!response.body) throw new ApiError(OFFLINE);
  yield* readNdjson<AskEvent>(response.body);
}

export interface CompareRequest extends Partial<
  Omit<ContextOptions, "chunkWords">
> {
  query: string;
  mode: RetrievalMode;
  expand: boolean;
}

export async function compare(
  body: CompareRequest,
  signal?: AbortSignal,
): Promise<CompareResult> {
  const response = await request("/api/compare", json(body, { signal }));
  return (await response.json()) as CompareResult;
}

export async function listPractice(): Promise<PracticeSummary[]> {
  const response = await request("/api/practice");
  return ((await response.json()) as { sets: PracticeSummary[] }).sets;
}

export async function getPractice(id: string): Promise<PracticeSet> {
  const response = await request(`/api/practice/${encodeURIComponent(id)}`);
  return (await response.json()) as PracticeSet;
}

export async function deletePractice(id: string): Promise<void> {
  await request(`/api/practice/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

type PracticeEvent =
  | ({ type: "progress" } & PracticeProgress)
  | { type: "done"; set: PracticeSet }
  | { type: "error"; error: string };

export async function makePractice(
  body: PracticeRequest,
  onProgress: (progress: PracticeProgress) => void,
  signal: AbortSignal,
): Promise<PracticeSet> {
  const response = await request("/api/practice", json(body, { signal }));
  if (!response.body) throw new ApiError(OFFLINE);
  for await (const event of readNdjson<PracticeEvent>(response.body)) {
    if (event.type === "error") throw new ApiError(event.error);
    if (event.type === "done") return event.set;
    onProgress({
      stage: event.stage,
      chars: event.chars,
      reason: event.reason,
    });
  }
  throw new ApiError("The practice set ended before it was ready. Try again.");
}
