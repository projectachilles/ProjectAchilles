// An in-memory localStorage for tests. Node 25 ships a global `localStorage` that
// shadows jsdom's and has no working methods, so the report tests stub their own.
// Undo with vi.unstubAllGlobals().
import { vi } from 'vitest';

export function stubMemoryStorage(): Storage {
  const data = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

/** Makes reading `window.localStorage` itself throw, as blocked site data does in some browsers. */
export function blockStorageAccess(): void {
  stubMemoryStorage();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); },
  });
}
