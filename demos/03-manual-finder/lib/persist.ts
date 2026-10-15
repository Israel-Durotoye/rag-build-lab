/**
 * Small values kept per browser (the chosen model, recent searches), read
 * with React's useSyncExternalStore: the server and the first client render
 * use the fallback, then the stored value, with no effect needed. A change
 * in another tab arrives through the storage event. When storage is
 * blocked (private mode) the value lasts for this page only.
 */

type Listener = () => void;

export interface StoredValue<T> {
  get: () => T;
  getServer: () => T;
  set: (value: T) => void;
  subscribe: (listener: Listener) => () => void;
}

export function storedValue<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => boolean,
): StoredValue<T> {
  const listeners = new Set<Listener>();
  // The snapshot must be the same object until the stored text changes.
  let cache: { raw: string | null; value: T } | null = null;
  let memory: { value: T } | null = null;

  const get = (): T => {
    // A value that couldn't be written (storage blocked or full) lasts for
    // this page, ahead of whatever storage still holds.
    if (memory) return memory.value;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return fallback;
    }
    if (cache && cache.raw === raw) return cache.value;
    let value = fallback;
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (valid(parsed)) value = parsed as T;
      } catch {
        // An unreadable value counts as none.
      }
    }
    cache = { raw, value };
    return value;
  };

  const set = (value: T) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      memory = null;
    } catch {
      memory = { value };
    }
    cache = null;
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) {
        cache = null;
        listener();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };

  return { get, getServer: () => fallback, set, subscribe };
}
