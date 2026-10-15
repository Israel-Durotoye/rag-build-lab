import type { Health } from "./types";

/** Increment when a frontend/backend payload or stream contract changes. */
export const API_VERSION = 1;
export const API_VERSION_HEADER = "X-Manual-API-Version";

export function isCompatibleHealth(value: unknown): value is Health {
  if (!value || typeof value !== "object") return false;
  const health = value as Partial<Health>;
  return health.status === "ok" && health.apiVersion === API_VERSION;
}

export type BackendProblem = "unreachable" | "incompatible";

/**
 * Classify a response that came back through the /api proxy.
 *
 * Every reply from the Python backend carries the contract header. A reply
 * without it did not come from the backend at all: a proxy or host error page
 * (the backend is asleep or still building, the rewrite target is wrong), so
 * it is "unreachable" rather than a version mismatch. A successful reply
 * without the header, or one with a different version, is a backend that does
 * not belong with this frontend.
 */
export function backendProblem(response: {
  ok: boolean;
  versionHeader: string | null;
}): BackendProblem | null {
  const { ok, versionHeader } = response;
  if (versionHeader === String(API_VERSION)) return null;
  if (versionHeader === null) return ok ? "incompatible" : "unreachable";
  return "incompatible";
}
