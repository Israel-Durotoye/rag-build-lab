import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { storedValue } from "../lib/persist";

const original = (globalThis as { window?: unknown }).window;
afterEach(() => {
  (globalThis as { window?: unknown }).window = original;
});

/** A window whose localStorage holds ``items`` and may refuse writes. */
function fakeWindow(items: Record<string, string>, writable = true) {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => items[key] ?? null,
      setItem: (key: string, value: string) => {
        if (!writable) throw new Error("QuotaExceededError");
        items[key] = value;
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

type Choice = { model: string | null };
const NONE: Choice = { model: null };
const isModel = (v: unknown) =>
  !!v && typeof v === "object" && "model" in (v as object);

test("a stored value is read back, and the same object until it changes", () => {
  fakeWindow({ k: '{"model":"rpi-2b"}' });
  const store = storedValue<Choice>("k", NONE, isModel);
  assert.deepEqual(store.get(), { model: "rpi-2b" });
  assert.equal(store.get(), store.get());
  store.set({ model: "uno-r3" });
  assert.deepEqual(store.get(), { model: "uno-r3" });
});

test("unreadable or invalid values count as none", () => {
  fakeWindow({ a: "{not json", b: '"text"' });
  assert.deepEqual(storedValue<Choice>("a", NONE, isModel).get(), {
    model: null,
  });
  assert.deepEqual(storedValue<Choice>("b", NONE, isModel).get(), {
    model: null,
  });
});

test("when storage refuses a write, the new value still holds for the page", () => {
  fakeWindow({ k: '{"model":"rpi-2b"}' }, false);
  const store = storedValue<Choice>("k", NONE, isModel);
  store.set({ model: "uno-r4-wifi" });
  assert.deepEqual(store.get(), { model: "uno-r4-wifi" });
});
