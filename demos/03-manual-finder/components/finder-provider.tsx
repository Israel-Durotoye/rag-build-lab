"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ApiError,
  deleteDocument,
  getLibrary,
  getSettings,
  loadSample,
  saveSettings,
  uploadDocument,
} from "@/lib/api";
import { isCompatibleHealth } from "@/lib/contract";
import { storedValue } from "@/lib/persist";
import { newTurn, runnableMode, runTurn } from "@/lib/turns";
import type {
  AskRequest,
  Health,
  Library,
  LibraryModel,
  Prefs,
  RetrievalMode,
  Selection,
  SettingsResponse,
  Turn,
  UploadProgress,
} from "@/lib/types";

const SELECTION_KEY = "finder.selection.v1";
const RECENT_KEY = "finder.recent.v1";
const MAX_RECENT = 8;

export interface UploadOutcome {
  fileName: string;
  ok: boolean;
  message?: string;
}

interface FinderContext {
  health: Health | null;
  library: Library | null;
  libraryError: string | null;
  refreshLibrary: () => Promise<void>;
  /** A model of the library by ID. */
  modelById: (id: string | null | undefined) => LibraryModel | undefined;
  /** The model and revision chosen in the picker ("Working on"). */
  selection: Selection;
  setSelection: (selection: Selection) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  settings: SettingsResponse | null;
  settingsError: string | null;
  refreshSettings: () => Promise<void>;
  savePrefs: (patch: Partial<Prefs>) => Promise<SettingsResponse>;
  mode: RetrievalMode;
  setMode: (mode: RetrievalMode) => void;
  /** The current result on the Search page. */
  search: Turn | null;
  runSearch: (question: string, override?: Partial<Selection>) => Promise<void>;
  recent: string[];
  /** The chat conversation, oldest first. */
  turns: Turn[];
  /** Questions of the chat topic a follow-up may build on. */
  topic: string[];
  chat: (
    question: string,
    options?: { followUp?: boolean | "auto"; override?: Partial<Selection> },
  ) => Promise<void>;
  newTopic: () => void;
  clearChat: () => void;
  streaming: boolean;
  /** Stop the Search answer, or the chat answer, that is streaming. */
  stop: () => void;
  stopChat: () => void;
  /** The answer the Inspect page explains: the chosen one, else the latest. */
  inspected: Turn | null;
  inspect: (id: string) => void;
  upload: UploadProgress | null;
  uploadOutcomes: UploadOutcome[];
  uploadFiles: (files: File[]) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  sampleState: "idle" | "loading" | "failed";
  sampleError: string | null;
  addSample: () => Promise<void>;
}

const Context = createContext<FinderContext | null>(null);

export function useFinder(): FinderContext {
  const value = useContext(Context);
  if (!value) throw new Error("useFinder must be used inside <FinderProvider>");
  return value;
}

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.message ? cause.message : fallback;
}

function isSelection(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const { model, revision } = value as Selection;
  return (
    (model === null || typeof model === "string") &&
    (revision === null || typeof revision === "string") &&
    (model !== null || revision === null)
  );
}

const EMPTY_SELECTION: Selection = { model: null, revision: null };
const EMPTY_RECENT: string[] = [];

const selectionStore = storedValue<Selection>(
  SELECTION_KEY,
  EMPTY_SELECTION,
  isSelection,
);
const recentStore = storedValue<string[]>(
  RECENT_KEY,
  EMPTY_RECENT,
  (v) => Array.isArray(v) && v.every((q) => typeof q === "string"),
);

export function FinderProvider({
  initialHealth,
  children,
}: {
  initialHealth: Health | null;
  children: ReactNode;
}) {
  const [health, setHealth] = useState<Health | null>(initialHealth);
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const storedSelection = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.get,
    selectionStore.getServer,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [mode, setModeState] = useState<RetrievalMode>(
    initialHealth?.retrieval.default ?? "hybrid",
  );
  const [search, setSearch] = useState<Turn | null>(null);
  const storedRecent = useSyncExternalStore(
    recentStore.subscribe,
    recentStore.get,
    recentStore.getServer,
  );
  const recent = useMemo(
    () => storedRecent.slice(0, MAX_RECENT),
    [storedRecent],
  );
  const [turns, setTurns] = useState<Turn[]>([]);
  const [topic, setTopic] = useState<string[]>([]);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [uploadOutcomes, setUploadOutcomes] = useState<UploadOutcome[]>([]);
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "failed">(
    "idle",
  );
  const [sampleError, setSampleError] = useState<string | null>(null);
  // Search and Chat stream independently: asking or clearing in one never
  // stops the other.
  const searchController = useRef<AbortController | null>(null);
  const chatController = useRef<AbortController | null>(null);
  // Bumped by "New topic" and Clear, so an answer that finishes later
  // doesn't bring the old topic back.
  const topicEpoch = useRef(0);
  const modeChosen = useRef(false);

  // Keep checking the backend while it is unreachable or its embedding model
  // is still loading; stop once it is ready.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const body: unknown = await response.json();
        if (!cancelled) setHealth(isCompatibleHealth(body) ? body : null);
        if (
          !cancelled &&
          isCompatibleHealth(body) &&
          body.embeddings.status !== "loading"
        )
          return;
      } catch {
        if (!cancelled) setHealth(null);
      }
      if (!cancelled) timer = window.setTimeout(check, 5000);
    };
    if (!initialHealth || initialHealth.embeddings.status === "loading") {
      timer = window.setTimeout(check, initialHealth ? 3000 : 1500);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [initialHealth]);

  const refreshLibrary = useCallback(async () => {
    try {
      const next = await getLibrary();
      setLibrary(next);
      setLibraryError(null);
    } catch (cause) {
      setLibraryError(errorMessage(cause, "The library couldn't be loaded."));
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const reply = await getSettings();
      setSettings(reply);
      setSettingsError(null);
      if (!modeChosen.current) setModeState(reply.settings.mode);
    } catch (cause) {
      setSettingsError(errorMessage(cause, "Settings couldn't be loaded."));
    }
  }, []);

  // Load the library and settings once the backend answers.
  useEffect(() => {
    if (!health) return;
    let cancelled = false;
    getLibrary()
      .then((next) => {
        if (cancelled) return;
        setLibrary(next);
        setLibraryError(null);
      })
      .catch((cause) => {
        if (!cancelled)
          setLibraryError(
            errorMessage(cause, "The library couldn't be loaded."),
          );
      });
    getSettings()
      .then((reply) => {
        if (cancelled) return;
        setSettings(reply);
        setSettingsError(null);
        if (!modeChosen.current) setModeState(reply.settings.mode);
      })
      .catch((cause) => {
        if (!cancelled)
          setSettingsError(errorMessage(cause, "Settings couldn't be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [health]);

  const modelById = useCallback(
    (id: string | null | undefined) =>
      id ? library?.models.find((m) => m.id === id) : undefined,
    [library],
  );

  const setSelection = useCallback((next: Selection) => {
    selectionStore.set(next);
  }, []);

  // A remembered model (or revision) that is no longer in the library is
  // ignored, as if none had been chosen.
  const selection = useMemo<Selection>(() => {
    if (!library || !storedSelection.model) return storedSelection;
    const model = library.models.find((m) => m.id === storedSelection.model);
    if (!model) return EMPTY_SELECTION;
    if (
      storedSelection.revision &&
      !model.revisions.some((r) => r.id === storedSelection.revision)
    )
      return { model: model.id, revision: null };
    return storedSelection;
  }, [library, storedSelection]);

  const setMode = useCallback((next: RetrievalMode) => {
    modeChosen.current = true;
    setModeState(next);
  }, []);

  const savePrefs = useCallback(async (patch: Partial<Prefs>) => {
    const reply = await saveSettings(patch);
    setSettings(reply);
    if (patch.mode) setModeState(patch.mode);
    return reply;
  }, []);

  const begin = useCallback((slot: { current: AbortController | null }) => {
    slot.current?.abort();
    const next = new AbortController();
    slot.current = next;
    return next;
  }, []);

  const request = useCallback(
    (
      question: string,
      chosen: Selection,
      extra: Partial<AskRequest> = {},
    ): AskRequest => ({
      message: question,
      model: chosen.model,
      revision: chosen.revision,
      mode: runnableMode(mode, health?.embeddings.status ?? null),
      ...extra,
    }),
    [health, mode],
  );

  const runSearch = useCallback(
    async (question: string, override?: Partial<Selection>) => {
      const text = question.trim();
      if (!text) return;
      const chosen = { ...selection, ...override };
      const abort = begin(searchController);
      const turn = newTurn(text, chosen, mode);
      setSearch(turn);
      setInspectedId(null);
      recentStore.set(
        [text, ...recentStore.get().filter((q) => q !== text)].slice(
          0,
          MAX_RECENT,
        ),
      );
      // A stream that was replaced still sends its last update ("Stopped");
      // it must not overwrite the newer question's turn.
      const update = (next: Turn) =>
        setSearch((current) => (current?.id === next.id ? next : current));
      await runTurn(turn, request(text, chosen), update, abort.signal);
    },
    [begin, mode, request, selection],
  );

  const chat = useCallback(
    async (
      question: string,
      options: {
        followUp?: boolean | "auto";
        override?: Partial<Selection>;
      } = {},
    ) => {
      const text = question.trim();
      if (!text) return;
      const chosen = { ...selection, ...options.override };
      const abort = begin(chatController);
      const turn = newTurn(text, chosen, mode);
      const earlier = options.followUp === false ? [] : topic;
      const epoch = topicEpoch.current;
      setTurns((current) => [...current, turn]);
      setInspectedId(null);
      const update = (next: Turn) =>
        setTurns((current) =>
          current.map((t) => (t.id === next.id ? next : t)),
        );
      const final = await runTurn(
        turn,
        request(text, chosen, {
          earlier,
          followUp: options.followUp ?? "auto",
        }),
        update,
        abort.signal,
      );
      const conversation = final.done?.conversation;
      if (
        conversation &&
        final.done?.status !== "clarification" &&
        topicEpoch.current === epoch
      )
        setTopic(conversation.topic);
    },
    [begin, mode, request, selection, topic],
  );

  const stop = useCallback(() => searchController.current?.abort(), []);
  const stopChat = useCallback(() => chatController.current?.abort(), []);
  const newTopic = useCallback(() => {
    topicEpoch.current += 1;
    setTopic([]);
  }, []);
  const clearChat = useCallback(() => {
    chatController.current?.abort();
    topicEpoch.current += 1;
    setTurns([]);
    setTopic([]);
  }, []);

  const streaming = Boolean(
    search?.streaming || turns.some((t) => t.streaming),
  );

  const inspected = useMemo(() => {
    const all = [...turns, ...(search ? [search] : [])];
    const chosen = inspectedId
      ? all.find((t) => t.id === inspectedId)
      : undefined;
    if (chosen) return chosen;
    return all.reduce<Turn | null>(
      (latest, turn) =>
        !latest || turn.startedAt > latest.startedAt ? turn : latest,
      null,
    );
  }, [inspectedId, search, turns]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const outcomes: UploadOutcome[] = [];
      for (const [index, file] of files.entries()) {
        setUpload({
          fileName: file.name,
          stage: "reading",
          index,
          count: files.length,
        });
        try {
          await uploadDocument(file, (progress) =>
            setUpload({ ...progress, index, count: files.length }),
          );
          outcomes.push({ fileName: file.name, ok: true });
        } catch (cause) {
          outcomes.push({
            fileName: file.name,
            ok: false,
            message: errorMessage(cause, "This file couldn't be added."),
          });
        }
      }
      setUpload(null);
      setUploadOutcomes(outcomes);
      await refreshLibrary();
    },
    [refreshLibrary],
  );

  const removeDocument = useCallback(
    async (id: string) => {
      await deleteDocument(id);
      await refreshLibrary();
    },
    [refreshLibrary],
  );

  const addSample = useCallback(async () => {
    setSampleState("loading");
    setSampleError(null);
    try {
      await loadSample();
      await refreshLibrary();
      setSampleState("idle");
    } catch (cause) {
      setSampleState("failed");
      setSampleError(
        errorMessage(cause, "The sample library couldn't be loaded."),
      );
    }
  }, [refreshLibrary]);

  const value = useMemo<FinderContext>(
    () => ({
      health,
      library,
      libraryError,
      refreshLibrary,
      modelById,
      selection,
      setSelection,
      pickerOpen,
      setPickerOpen,
      settings,
      settingsError,
      refreshSettings,
      savePrefs,
      mode,
      setMode,
      search,
      runSearch,
      recent,
      turns,
      topic,
      chat,
      newTopic,
      clearChat,
      streaming,
      stop,
      stopChat,
      inspected,
      inspect: setInspectedId,
      upload,
      uploadOutcomes,
      uploadFiles,
      removeDocument,
      sampleState,
      sampleError,
      addSample,
    }),
    [
      health,
      library,
      libraryError,
      refreshLibrary,
      modelById,
      selection,
      setSelection,
      pickerOpen,
      settings,
      settingsError,
      refreshSettings,
      savePrefs,
      mode,
      setMode,
      search,
      runSearch,
      recent,
      turns,
      topic,
      chat,
      newTopic,
      clearChat,
      streaming,
      stop,
      stopChat,
      inspected,
      upload,
      uploadOutcomes,
      uploadFiles,
      removeDocument,
      sampleState,
      sampleError,
      addSample,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
