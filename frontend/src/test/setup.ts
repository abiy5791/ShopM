import "@testing-library/jest-dom/vitest";

// This jsdom setup exposes localStorage as an empty object (no setItem), which
// breaks zustand's persist middleware. Provide a real in-memory Storage.
if (typeof globalThis.localStorage?.setItem !== "function") {
  class MemoryStorage implements Storage {
    private data = new Map<string, string>();
    get length() {
      return this.data.size;
    }
    key(index: number) {
      return [...this.data.keys()][index] ?? null;
    }
    getItem(key: string) {
      return this.data.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.data.set(key, String(value));
    }
    removeItem(key: string) {
      this.data.delete(key);
    }
    clear() {
      this.data.clear();
    }
  }
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
}
