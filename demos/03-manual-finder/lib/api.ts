import type {
  AskEvent,
  AskRequest,
  CodeSuggestion,
  CodesMatrix,
  DocumentDetail,
  DocumentSummary,
  EvalProgress,
  EvalRun,
  EvaluationInfo,
  FamilyDef,
  LabResult,
  Library,
  ModelDef,
  ModelGuide,
  Prefs,
  RetrievalMode,
  SettingsResponse,
  UploadProgress,
} from "./types";
import { API_VERSION_HEADER, backendProblem } from "./contract";

/**
 * Browser-side client for the Python backend. Next.js proxies /api/* to it.
 * Every call carries this browser's workspace ID, which keeps one person's
 * manuals out of another's searches.
 */

const WORKSPACE_KEY = "finder.workspace.v1";
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
  "The Finder backend isn't reachable. It may still be starting; try again in a moment.";
const INCOMPATIBLE =
  "The Finder backend is out of date. Deploy the backend that belongs with this frontend.";

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

// ---------------------------------------------------------------- library

export async function getLibrary(): Promise<Library> {
  const response = await request("/api/library");
  return (await response.json()) as Library;
}

export async function loadSample(): Promise<DocumentSummary[]> {
  const response = await request("/api/sample", { method: "POST" });
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

export async function saveDocumentModels(
  id: string,
  models: ModelDef[],
  families: FamilyDef[],
): Promise<DocumentDetail> {
  const response = await request(
    `/api/documents/${encodeURIComponent(id)}/models`,
    json({ models, families }, { method: "PUT" }),
  );
  return (await response.json()) as DocumentDetail;
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
    "The upload ended before the manual was ready. Try again.",
  );
}

// ---------------------------------------------------------------- asking

export async function* ask(
  body: AskRequest,
  signal: AbortSignal,
): AsyncGenerator<AskEvent> {
  const response = await request("/api/ask", json(body, { signal }));
  if (!response.body) throw new ApiError(OFFLINE);
  yield* readNdjson<AskEvent>(response.body);
}

export interface LabRequest {
  query: string;
  model?: string | null;
  revision?: string | null;
  k?: number;
  constant?: number;
}

export async function runLab(
  body: LabRequest,
  signal?: AbortSignal,
): Promise<LabResult> {
  const response = await request("/api/lab", json(body, { signal }));
  return (await response.json()) as LabResult;
}

// ---------------------------------------------------------------- codes, models

export async function getCodes(
  params: { q?: string; family?: string; differs?: boolean } = {},
  signal?: AbortSignal,
): Promise<CodesMatrix> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.family) search.set("family", params.family);
  if (params.differs) search.set("differs", "1");
  const query = search.toString();
  const response = await request(`/api/codes${query ? `?${query}` : ""}`, {
    signal,
  });
  return (await response.json()) as CodesMatrix;
}

export async function suggestCodes(
  q: string,
  model: string | null,
  signal?: AbortSignal,
): Promise<CodeSuggestion[]> {
  const search = new URLSearchParams({ q });
  if (model) search.set("model", model);
  const response = await request(`/api/codes/suggest?${search}`, { signal });
  return ((await response.json()) as { suggestions: CodeSuggestion[] })
    .suggestions;
}

export async function getGuide(model: string): Promise<ModelGuide> {
  const response = await request(
    `/api/models/${encodeURIComponent(model)}/guide`,
  );
  return (await response.json()) as ModelGuide;
}

// ---------------------------------------------------------------- evaluation

export async function getEvaluation(): Promise<EvaluationInfo> {
  const response = await request("/api/evaluation");
  return (await response.json()) as EvaluationInfo;
}

export async function getEvalRun(id: string): Promise<EvalRun> {
  const response = await request(
    `/api/evaluation/runs/${encodeURIComponent(id)}`,
  );
  return (await response.json()) as EvalRun;
}

export async function deleteEvalRun(id: string): Promise<void> {
  await request(`/api/evaluation/runs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

type EvalEvent =
  | ({ type: "progress" } & EvalProgress)
  | { type: "done"; run: EvalRun }
  | { type: "error"; error: string };

export async function runEvaluation(
  body: { modes?: RetrievalMode[]; k?: number; constant?: number },
  onProgress: (progress: EvalProgress) => void,
  signal?: AbortSignal,
): Promise<EvalRun> {
  const response = await request("/api/evaluation/run", json(body, { signal }));
  if (!response.body) throw new ApiError(OFFLINE);
  for await (const event of readNdjson<EvalEvent>(response.body)) {
    if (event.type === "error") throw new ApiError(event.error);
    if (event.type === "done") return event.run;
    onProgress({ done: event.done, total: event.total, query: event.query });
  }
  throw new ApiError("The evaluation ended before it finished. Try again.");
}

// ---------------------------------------------------------------- settings

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
