"use client";

/**
 * A tiny localStorage-backed store for useSyncExternalStore. The server
 * snapshot is always the default, so SSR markup is stable; the stored value
 * takes over after hydration. Storage failures (private mode) are ignored.
 */
export interface PersistedStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
  getServerSnapshot(): T;
  set(value: T): void;
}

export function createPersistedStore<T>(key: string, fallback: T, parse: (raw: unknown) => T): PersistedStore<T> {
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cachedValue: T = fallback;
  let memoryValue: T | undefined; // used when localStorage is unavailable

  function read(): T {
    if (memoryValue !== undefined) return memoryValue;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return fallback;
    }
    if (raw === cachedRaw) return cachedValue;
    cachedRaw = raw;
    try {
      cachedValue = raw === null ? fallback : parse(JSON.parse(raw));
    } catch {
      cachedValue = fallback;
    }
    return cachedValue;
  }

  function onStorage(e: StorageEvent) {
    if (e.key === key) listeners.forEach((l) => l());
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: read,
    getServerSnapshot: () => fallback,
    set(value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        memoryValue = undefined;
      } catch {
        memoryValue = value;
      }
      listeners.forEach((l) => l());
    },
  };
}
