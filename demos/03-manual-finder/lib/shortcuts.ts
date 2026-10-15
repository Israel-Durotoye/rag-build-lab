import { storedValue } from "./persist";

/**
 * Whether the single-key shortcuts ("/" for the search box, "m" for the
 * model picker) are on in this browser. They can be turned off in Settings,
 * for people whose speech input or assistive software types single letters.
 */
export const shortcutsStore = storedValue<boolean>(
  "finder.shortcuts.v1",
  true,
  (value) => typeof value === "boolean",
);
