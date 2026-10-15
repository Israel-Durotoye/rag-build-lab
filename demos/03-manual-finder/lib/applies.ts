import type { Unit } from "./types";

/**
 * Whether a passage applies to a model (and revision), exactly as the
 * backend decides (backend/variants.py `applies`): a shared passage (models
 * null) applies to every model its manual covers, or to any model when the
 * manual lists none; otherwise the model must be one of its own. A revision
 * narrows it only where the passage lists revisions of that model.
 */
export function unitApplies(
  unit: Pick<Unit, "models" | "revisions">,
  documentModels: string[],
  model: string,
  revision: string | null = null,
): boolean {
  if (unit.models === null) {
    if (documentModels.length > 0 && !documentModels.includes(model))
      return false;
  } else if (!unit.models.includes(model)) return false;
  if (revision !== null) {
    const allowed = unit.revisions?.[model];
    if (allowed != null && !allowed.includes(revision)) return false;
  }
  return true;
}
