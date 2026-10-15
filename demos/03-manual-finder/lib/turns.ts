import { ask, ApiError } from "./api";
import type {
  AskEvent,
  AskRequest,
  Health,
  RetrievalMode,
  Selection,
  Turn,
} from "./types";

/**
 * One question's lifetime on the client: a Turn starts empty and each event
 * from /api/ask fills in the next layer (identify → card → retrieval →
 * context → tokens → done). Search, Chat and "Same question, other model"
 * all run turns through here.
 */

let counter = 0;

export function newTurn(
  question: string,
  selection: Selection,
  mode: RetrievalMode,
): Turn {
  counter += 1;
  return {
    id: `turn-${Date.now().toString(36)}-${counter}`,
    question,
    selection,
    mode,
    stage: "identify",
    identify: null,
    clarification: null,
    card: null,
    retrieval: null,
    excluded: null,
    context: null,
    attempts: [],
    reasoning: "",
    answer: "",
    done: null,
    error: null,
    streaming: true,
    startedAt: Date.now(),
  };
}

export function applyEvent(turn: Turn, event: AskEvent): Turn {
  switch (event.type) {
    case "stage":
      return { ...turn, stage: event.stage };
    case "identify":
      return { ...turn, identify: event.trace };
    case "clarification":
      return { ...turn, clarification: event.clarification };
    case "card":
      return { ...turn, card: event.card };
    case "retrieval":
      return { ...turn, retrieval: event.trace };
    case "excluded":
      return { ...turn, excluded: event.excluded };
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
        // Partial reasoning from a failed attempt is discarded.
        reasoning: "",
        attempts: turn.attempts.map((attempt, index) =>
          index === turn.attempts.length - 1
            ? { ...attempt, ok: false, reason: event.reason }
            : attempt,
        ),
      };
    case "reasoning":
      return { ...turn, reasoning: turn.reasoning + event.delta };
    case "token":
      return { ...turn, answer: turn.answer + event.delta };
    case "done":
      return {
        ...turn,
        done: event,
        stage: null,
        streaming: false,
        clarification: event.clarification ?? turn.clarification,
        card: event.card ?? turn.card,
        excluded: event.excluded ?? turn.excluded,
        answer: event.answer ?? turn.answer,
        attempts: event.generation?.attempts ?? turn.attempts,
      };
    case "error":
      return { ...turn, error: event.error, streaming: false, stage: null };
  }
}

/**
 * Stream one question. ``onUpdate`` receives the turn after every event;
 * the final turn is also returned. Errors end the turn instead of throwing,
 * except an abort, which ends it as "Stopped".
 */
export async function runTurn(
  turn: Turn,
  request: AskRequest,
  onUpdate: (turn: Turn) => void,
  signal: AbortSignal,
): Promise<Turn> {
  let current = turn;
  try {
    for await (const event of ask(request, signal)) {
      current = applyEvent(current, event);
      onUpdate(current);
    }
    if (current.streaming) {
      current = {
        ...current,
        streaming: false,
        stage: null,
        error: current.error ?? "The answer ended before it was complete.",
      };
    }
  } catch (cause) {
    const aborted = (cause as Error)?.name === "AbortError";
    current = {
      ...current,
      streaming: false,
      stage: null,
      // An unreachable backend is an ApiError already; anything else that
      // breaks the read is the connection dropping mid-stream.
      error: aborted
        ? "Stopped."
        : cause instanceof ApiError
          ? cause.message
          : cause instanceof SyntaxError
            ? "Something went wrong. Try again."
            : "The connection dropped before the answer finished. Try again.",
    };
  }
  onUpdate(current);
  return current;
}

/**
 * The search mode a question can run in now. Hybrid and semantic search need
 * the embedding model; until it is ready (or when it is off or failed)
 * questions go by keyword, since the backend would otherwise wait for the
 * model to load. The chosen mode is kept, so it applies again once the model
 * is ready.
 */
export function runnableMode(
  mode: RetrievalMode,
  semantic: Health["embeddings"]["status"] | null,
): RetrievalMode {
  return semantic === "ready" ? mode : "keyword";
}
