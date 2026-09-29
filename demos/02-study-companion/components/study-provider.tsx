"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  ask as askBackend,
  compare,
  deleteDocument,
  getDocument,
  getSample,
  getSettings,
  listDocuments,
  loadSample,
  saveSettings,
  uploadDocument,
  writeOverview,
} from "@/lib/api";
import { isCompatibleHealth } from "@/lib/contract";
import type {
  AskEvent,
  Chunking,
  CompareResult,
  ContextOptions,
  DocumentDetail,
  DocumentSummary,
  Health,
  Prefs,
  RetrievalMode,
  SampleInfo,
  SettingsResponse,
  Turn,
  UploadProgress,
} from "@/lib/types";

export interface UploadOutcome {
  fileName: string;
  ok: boolean;
  message?: string;
}

/** The last run of the chunking lab, kept while moving between pages. */
export interface LabState {
  question: string;
  result: CompareResult | null;
  running: boolean;
  error: string | null;
}

export interface LabOptions {
  expand?: boolean;
  /** Left out, the student's saved settings apply. */
  numbers?: Omit<ContextOptions, "chunkWords">;
}

interface StudyContext {
  health: Health | null;
  documents: DocumentSummary[] | null;
  documentsError: string | null;
  refreshDocuments: () => Promise<void>;
  /** One set of notes with its sections, fetched once and reused. */
  documentDetail: (id: string) => Promise<DocumentDetail>;
  upload: UploadProgress | null;
  /** Results of the last upload batch, newest batch replaces the previous. */
  uploadOutcomes: UploadOutcome[];
  uploadFiles: (files: File[]) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  sample: SampleInfo | null;
  sampleState: "idle" | "loading" | "failed";
  addSample: () => Promise<void>;
  overviewPending: Record<string, boolean>;
  requestOverview: (id: string) => Promise<void>;
  settings: SettingsResponse | null;
  savePrefs: (patch: Partial<Prefs>) => Promise<SettingsResponse>;
  turns: Turn[];
  streaming: boolean;
  /** Questions of the topic the next question may follow up on. */
  topic: string[];
  ask: (question: string, followUp?: boolean | "auto") => Promise<void>;
  stop: () => void;
  newTopic: () => void;
  clearConversation: () => void;
  /** The turn the inspection pages explain: the chosen one, else the latest. */
  inspected: Turn | null;
  inspect: (id: string) => void;
  mode: RetrievalMode;
  setMode: (mode: RetrievalMode) => void;
  chunking: Chunking;
  setChunking: (chunking: Chunking) => void;
  expand: boolean;
  setExpand: (expand: boolean) => void;
  draft: string;
  setDraft: (text: string) => void;
  lab: LabState;
  /** Run one question against both chunkings. */
  runLab: (question: string, options?: LabOptions) => Promise<void>;
  /** Show a comparison that was already run (from a question set). */
  openLab: (question: string, result: CompareResult) => void;
}

const Context = createContext<StudyContext | null>(null);

export function useStudy(): StudyContext {
  const value = useContext(Context);
  if (!value) throw new Error("useStudy must be used inside <StudyProvider>");
  return value;
}

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.message ? cause.message : fallback;
}

function applyEvent(turn: Turn, event: AskEvent): Turn {
  switch (event.type) {
    case "stage":
      return { ...turn, stage: event.stage };
    case "retrieval":
      return { ...turn, retrieval: event.trace };
    case "context":
      return { ...turn, context: event.trace };
    case "generation.attempt":
      return {
        ...turn,
        attempts: [
          ...turn.attempts,
          { model: event.model, attempt: event.attempt, ok: null },
        ],
      };
    case "generation.retry":
      return {
        ...turn,
        reasoning: "",
        attempts: turn.attempts.map((a, i) =>
          i === turn.attempts.length - 1
            ? { ...a, ok: false, reason: event.reason }
            : a,
        ),
      };
    case "reasoning":
      return { ...turn, reasoning: turn.reasoning + event.delta };
    case "token":
      return { ...turn, answer: turn.answer + event.delta };
    case "done":
      return {
        ...turn,
        stage: "done",
        done: event,
        answer: event.answer ?? turn.answer,
        attempts: event.generation.attempts,
        reasoning: event.generation.reasoning || turn.reasoning,
      };
    case "error":
      return { ...turn, stage: "error", error: event.error };
  }
}

export function StudyProvider({
  initialHealth,
  children,
}: {
  initialHealth: Health | null;
  children: ReactNode;
}) {
  const [health, setHealth] = useState(initialHealth);
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [uploadOutcomes, setUploadOutcomes] = useState<UploadOutcome[]>([]);
  const [sample, setSample] = useState<SampleInfo | null>(null);
  const [sampleState, setSampleState] =
    useState<StudyContext["sampleState"]>("idle");
  const [overviewPending, setOverviewPending] = useState<
    Record<string, boolean>
  >({});
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [topic, setTopic] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<RetrievalMode>(
    initialHealth?.retrieval.default ?? "hybrid",
  );
  const [chunking, setChunking] = useState<Chunking>("section");
  const [expand, setExpand] = useState(true);
  const [draft, setDraft] = useState("");
  const [lab, setLab] = useState<LabState>({
    question: "",
    result: null,
    running: false,
    error: null,
  });
  const [statusTick, setStatusTick] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const details = useRef(new Map<string, Promise<DocumentDetail>>());

  const refreshDocuments = useCallback(async () => {
    details.current.clear();
    try {
      const [list, info] = await Promise.all([listDocuments(), getSample()]);
      setDocuments(list);
      setSample(info);
      setDocumentsError(null);
    } catch (cause) {
      setDocuments((current) => current ?? []);
      setDocumentsError(errorMessage(cause, "Your notes could not be loaded."));
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await getSettings());
    } catch {
      /* the Settings page reports it */
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
    void refreshSettings();
  }, [refreshDocuments, refreshSettings]);

  // Keep checking the backend while it is unreachable (the page rendered
  // before a hosted backend woke up) or while its embedding model is still
  // loading. Each failed check waits a little longer, up to half a minute.
  const statusChecks = useRef(0);
  useEffect(() => {
    const waiting = !health || health.embeddings.status === "loading";
    if (!waiting) {
      statusChecks.current = 0;
      return;
    }
    const delay = Math.min(3000 * 2 ** statusChecks.current, 30000);
    const timer = window.setTimeout(async () => {
      statusChecks.current += 1;
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (response.ok) {
          const next: unknown = await response.json();
          if (isCompatibleHealth(next)) {
            statusChecks.current = 0;
            const wasOffline = !health;
            setHealth(next);
            if (wasOffline) {
              void refreshDocuments();
              void refreshSettings();
            }
            return;
          }
        }
      } catch {
        /* the backend is not up yet */
      }
      setStatusTick((n) => n + 1); // schedule the next attempt
    }, delay);
    return () => window.clearTimeout(timer);
  }, [health, statusTick, refreshDocuments, refreshSettings]);

  const documentDetail = useCallback((id: string) => {
    const cached = details.current.get(id);
    if (cached) return cached;
    const request = getDocument(id);
    details.current.set(id, request);
    request.catch(() => details.current.delete(id));
    return request;
  }, []);

  const requestOverview = useCallback(async (id: string) => {
    setOverviewPending((p) => ({ ...p, [id]: true }));
    try {
      const overview = await writeOverview(id);
      setDocuments((list) =>
        list ? list.map((d) => (d.id === id ? { ...d, overview } : d)) : list,
      );
    } catch {
      /* the Notes page offers a retry */
    } finally {
      setOverviewPending((p) => ({ ...p, [id]: false }));
    }
  }, []);

  const describe = useCallback(
    (added: DocumentSummary[]) => {
      if (!health?.generation) return;
      for (const document of added)
        if (!document.overview) void requestOverview(document.id);
    },
    [health, requestOverview],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || upload) return;
      const outcomes: UploadOutcome[] = [];
      setUploadOutcomes([]);
      const added: DocumentSummary[] = [];
      for (const [index, file] of files.entries()) {
        setUpload({
          fileName: file.name,
          stage: "reading",
          index: index + 1,
          count: files.length,
        });
        try {
          const document = await uploadDocument(file, (next) =>
            setUpload((previous) => ({
              ...next,
              index: index + 1,
              count: files.length,
              sawOcr: previous?.sawOcr || next.stage === "ocr",
            })),
          );
          added.push(document);
          outcomes.push({ fileName: file.name, ok: true });
        } catch (cause) {
          outcomes.push({
            fileName: file.name,
            ok: false,
            message: errorMessage(cause, "This file could not be processed."),
          });
        }
        setUploadOutcomes([...outcomes]);
      }
      setUpload(null);
      await Promise.all([refreshDocuments(), refreshSettings()]);
      describe(added);
    },
    [describe, refreshDocuments, refreshSettings, upload],
  );

  const addSample = useCallback(async () => {
    setSampleState("loading");
    try {
      const added = await loadSample();
      await Promise.all([refreshDocuments(), refreshSettings()]);
      setSampleState("idle");
      describe(added);
    } catch {
      setSampleState("failed");
    }
  }, [describe, refreshDocuments, refreshSettings]);

  const removeDocument = useCallback(
    async (id: string) => {
      await deleteDocument(id);
      await Promise.all([refreshDocuments(), refreshSettings()]);
    },
    [refreshDocuments, refreshSettings],
  );

  const savePrefs = useCallback(async (patch: Partial<Prefs>) => {
    const saved = await saveSettings(patch);
    setSettings(saved);
    // A new chunk size changes what every set of notes reports about itself.
    if (saved.rechunked != null) details.current.clear();
    return saved;
  }, []);

  const ask = useCallback(
    async (question: string, followUp: boolean | "auto" = "auto") => {
      const text = question.trim();
      if (!text || streaming) return;
      const earlier = followUp === false ? [] : topic;
      const id = crypto.randomUUID();
      const turn: Turn = {
        id,
        question: text,
        earlier,
        mode,
        chunking,
        expand,
        startedAt: Date.now(),
        stage: earlier.length ? "rewrite" : "retrieval",
        attempts: [],
        reasoning: "",
        answer: "",
      };
      setTurns((list) => [...list, turn]);
      setInspectedId(null);
      setStreaming(true);
      const abort = new AbortController();
      controller.current = abort;
      const update = (fn: (t: Turn) => Turn) =>
        setTurns((list) => list.map((t) => (t.id === id ? fn(t) : t)));
      try {
        const events = askBackend(
          { message: text, earlier, followUp, mode, chunking, expand },
          abort.signal,
        );
        for await (const event of events) {
          update((t) => applyEvent(t, event));
          if (event.type === "done") setTopic(event.conversation.topic);
        }
        update((t) =>
          t.stage === "done" || t.stage === "error"
            ? t
            : {
                ...t,
                stage: "error",
                error: "The answer stream ended early. Try again.",
              },
        );
      } catch (cause) {
        if ((cause as Error)?.name === "AbortError")
          update((t) => ({ ...t, stage: "stopped" }));
        else
          update((t) => ({
            ...t,
            stage: "error",
            error: errorMessage(cause, "Something went wrong. Try again."),
          }));
      } finally {
        controller.current = null;
        setStreaming(false);
      }
    },
    [chunking, expand, mode, streaming, topic],
  );

  const runLab = useCallback(
    async (question: string, options: LabOptions = {}) => {
      const query = question.trim();
      if (!query) return;
      setLab((current) => ({
        question: query,
        result: current.question === query ? current.result : null,
        running: true,
        error: null,
      }));
      try {
        const result = await compare({
          query,
          mode,
          expand: options.expand ?? true,
          ...options.numbers,
        });
        setLab({ question: query, result, running: false, error: null });
      } catch (cause) {
        setLab((current) => ({
          ...current,
          running: false,
          error: errorMessage(cause, "The comparison could not be run."),
        }));
      }
    },
    [mode],
  );
  const openLab = useCallback(
    (question: string, result: CompareResult) =>
      setLab({ question, result, running: false, error: null }),
    [],
  );

  const stop = useCallback(() => controller.current?.abort(), []);
  const newTopic = useCallback(() => setTopic([]), []);
  const clearConversation = useCallback(() => {
    controller.current?.abort();
    setTurns([]);
    setTopic([]);
    setInspectedId(null);
  }, []);

  const inspected = useMemo(
    () => turns.find((t) => t.id === inspectedId) ?? turns.at(-1) ?? null,
    [turns, inspectedId],
  );

  const value: StudyContext = {
    health,
    documents,
    documentsError,
    refreshDocuments,
    documentDetail,
    upload,
    uploadOutcomes,
    uploadFiles,
    removeDocument,
    sample,
    sampleState,
    addSample,
    overviewPending,
    requestOverview,
    settings,
    savePrefs,
    turns,
    streaming,
    topic,
    ask,
    stop,
    newTopic,
    clearConversation,
    inspected,
    inspect: setInspectedId,
    mode,
    setMode,
    chunking,
    setChunking,
    expand,
    setExpand,
    draft,
    setDraft,
    lab,
    runLab,
    openLab,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
