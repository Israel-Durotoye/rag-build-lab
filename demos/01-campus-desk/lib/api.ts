import type {
  ChatEvent,
  DocumentDetail,
  DocumentSummary,
  GuideSettings,
  Overview,
  Profile,
  RetrievalMode,
  SettingsResponse,
  UploadProgress,
} from "./types";
import { API_VERSION_HEADER, backendProblem } from "./contract";

/**
 * Browser-side client for the Python backend. Next.js proxies /api/* to it.
 * Every call carries this browser's workspace ID, which keeps one visitor's
 * documents out of another's searches.
 */

const WORKSPACE_KEY = "campus-guide.workspace.v1";
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
  "The Campus Guide backend isn't reachable. It may still be starting; try again in a moment.";
const INCOMPATIBLE =
  "The Campus Guide backend is out of date. Deploy the backend that belongs with this frontend.";

/**
 * A hosted backend's edge (a Hugging Face Space, for instance) now and then
 * answers 502 before the request reaches the backend at all. Such a reply has
 * no contract header, so it is safe to send the same request again, uploads
 * and chat turns included: nothing was processed. Two more attempts, spaced
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

type UploadEvent =
  | ({ type: "progress" } & Omit<UploadProgress, "fileName">)
  | { type: "done"; document: DocumentSummary }
  | { type: "error"; error: string };

export async function getProfile(): Promise<{
  profile: Profile | null;
  documents: number;
  generation: boolean;
}> {
  const response = await request("/api/profile");
  return (await response.json()) as {
    profile: Profile | null;
    documents: number;
    generation: boolean;
  };
}

export async function makeProfile(): Promise<Profile> {
  const response = await request("/api/profile", { method: "POST" });
  return ((await response.json()) as { profile: Profile }).profile;
}

export async function getSettings(): Promise<SettingsResponse> {
  const response = await request("/api/settings");
  return (await response.json()) as SettingsResponse;
}

export async function saveSettings(
  patch: Partial<GuideSettings>,
): Promise<SettingsResponse> {
  const response = await request("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await response.json()) as SettingsResponse;
}

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
    "The upload ended before the document was ready. Try again.",
  );
}

export async function* chat(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  mode: RetrievalMode,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const response = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, mode }),
    signal,
  });
  if (!response.body) throw new ApiError(OFFLINE);
  yield* readNdjson<ChatEvent>(response.body);
}
