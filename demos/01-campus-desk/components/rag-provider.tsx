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
  chat,
  deleteDocument,
  getProfile,
  listDocuments,
  makeProfile,
  uploadDocument,
  writeOverview,
} from "@/lib/api";
import { isCompatibleHealth } from "@/lib/contract";
import type {
  ChatEvent,
  DocumentSummary,
  Health,
  Profile,
  RetrievalMode,
  Turn,
  UploadProgress,
} from "@/lib/types";

export interface UploadOutcome {
  fileName: string;
  ok: boolean;
  message?: string;
}

interface RagContext {
  health: Health | null;
  documents: DocumentSummary[] | null;
  documentsError: string | null;
  refreshDocuments: () => Promise<void>;
  upload: UploadProgress | null;
  /** Results of the last upload batch, newest batch replaces the previous. */
  uploadOutcomes: UploadOutcome[];
  uploadFiles: (files: File[]) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  overviewPending: Record<string, boolean>;
  requestOverview: (id: string) => Promise<void>;
  profile: Profile | null;
  profileState: "idle" | "loading" | "writing" | "ready" | "failed";
  refreshProfile: (force?: boolean) => Promise<void>;
  turns: Turn[];
  streaming: boolean;
  ask: (question: string) => Promise<void>;
  stop: () => void;
  clearChat: () => void;
  /** The turn the inspection pages explain: the chosen one, else the latest. */
  inspected: Turn | null;
  inspect: (id: string) => void;
  mode: RetrievalMode;
  setMode: (mode: RetrievalMode) => void;
  draft: string;
  setDraft: (text: string) => void;
}

const Context = createContext<RagContext | null>(null);

export function useRag(): RagContext {
  const value = useContext(Context);
  if (!value) throw new Error("useRag must be used inside <RagProvider>");
  return value;
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.message ? cause.message : fallback;
}

function applyEvent(turn: Turn, event: ChatEvent): Turn {
  switch (event.type) {
    case "stage":
      return { ...turn, stage: event.stage };
    case "retrieval":
      return { ...turn, retrieval: event.trace };
    case "augmentation":
      return { ...turn, augmentation: event.trace };
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

export function RagProvider({
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
  const [overviewPending, setOverviewPending] = useState<
    Record<string, boolean>
  >({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileState, setProfileState] =
    useState<RagContext["profileState"]>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<RetrievalMode>(
    initialHealth?.retrieval.default ?? "hybrid",
  );
  const [draft, setDraft] = useState("");
  const [statusTick, setStatusTick] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const profileRequest = useRef<Promise<void> | null>(null);

  const refreshDocuments = useCallback(async () => {
    try {
      const list = await listDocuments();
      setDocuments(list);
      setDocumentsError(null);
    } catch (cause) {
      setDocuments((current) => current ?? []);
      setDocumentsError(message(cause, "Documents could not be loaded."));
    }
  }, []);

  // Load the welcome-page content; write it (once) when documents exist but
  // no up-to-date profile does. Concurrent callers share one request.
  const refreshProfile = useCallback(async (force = false) => {
    if (profileRequest.current && !force) return profileRequest.current;
    const run = (async () => {
      setProfileState((s) => (s === "ready" ? s : "loading"));
      try {
        const current = await getProfile();
        if (current.profile && !force) {
          setProfile(current.profile);
          setProfileState("ready");
          return;
        }
        if (!current.documents || !current.generation) {
          setProfile(null);
          setProfileState("idle");
          return;
        }
        setProfileState("writing");
        setProfile(await makeProfile());
        setProfileState("ready");
      } catch {
        setProfileState("failed");
      } finally {
        profileRequest.current = null;
      }
    })();
    profileRequest.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refreshDocuments();
    void refreshProfile();
  }, [refreshDocuments, refreshProfile]);

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
            setHealth(next);
            return;
          }
        }
      } catch {
        /* the backend is not up yet */
      }
      setStatusTick((n) => n + 1); // schedule the next attempt
    }, delay);
    return () => window.clearTimeout(timer);
  }, [health, statusTick]);

  const requestOverview = useCallback(async (id: string) => {
    setOverviewPending((p) => ({ ...p, [id]: true }));
    try {
      const overview = await writeOverview(id);
      setDocuments((list) =>
        list ? list.map((d) => (d.id === id ? { ...d, overview } : d)) : list,
      );
    } catch {
      /* the Library page offers a retry */
    } finally {
      setOverviewPending((p) => ({ ...p, [id]: false }));
    }
  }, []);

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
            message: message(cause, "This file could not be processed."),
          });
        }
        setUploadOutcomes([...outcomes]);
      }
      setUpload(null);
      await refreshDocuments();
      if (added.length) {
        // The welcome page and each document's overview describe the new set.
        void refreshProfile(true);
        if (health?.generation)
          for (const document of added)
            if (!document.overview) void requestOverview(document.id);
      }
    },
    [health, refreshDocuments, refreshProfile, requestOverview, upload],
  );

  const removeDocument = useCallback(
    async (id: string) => {
      await deleteDocument(id);
      await refreshDocuments();
      setProfile(null);
      void refreshProfile(true);
    },
    [refreshDocuments, refreshProfile],
  );

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || streaming) return;
      const history = turns
        .filter((t) => t.stage === "done" && (t.done?.answer || t.answer))
        .slice(-3)
        .flatMap((t) => [
          { role: "user" as const, content: t.question },
          { role: "assistant" as const, content: t.done?.answer ?? t.answer },
        ]);
      const id = crypto.randomUUID();
      const turn: Turn = {
        id,
        question: text,
        mode,
        startedAt: Date.now(),
        stage: "retrieval",
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
        for await (const event of chat(text, history, mode, abort.signal))
          update((t) => applyEvent(t, event));
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
            error: message(cause, "Something went wrong. Try again."),
          }));
      } finally {
        controller.current = null;
        setStreaming(false);
      }
    },
    [mode, streaming, turns],
  );

  const stop = useCallback(() => controller.current?.abort(), []);
  const clearChat = useCallback(() => {
    controller.current?.abort();
    setTurns([]);
    setInspectedId(null);
  }, []);

  const inspected = useMemo(
    () => turns.find((t) => t.id === inspectedId) ?? turns.at(-1) ?? null,
    [turns, inspectedId],
  );

  const value: RagContext = {
    health,
    documents,
    documentsError,
    refreshDocuments,
    upload,
    uploadOutcomes,
    uploadFiles,
    removeDocument,
    overviewPending,
    requestOverview,
    profile,
    profileState,
    refreshProfile,
    turns,
    streaming,
    ask,
    stop,
    clearChat,
    inspected,
    inspect: setInspectedId,
    mode,
    setMode,
    draft,
    setDraft,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
