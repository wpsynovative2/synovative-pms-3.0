"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A boolean remembered in localStorage, read through `useSyncExternalStore`
 * so the server render and hydration agree without a setState-in-effect.
 */

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

export function usePersistentFlag(
  key: string,
  serverValue = false,
): [boolean, (next: boolean) => void] {
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key) === "true";
    } catch {
      return serverValue;
    }
  }, [key, serverValue]);

  const getServerSnapshot = useCallback(() => serverValue, [serverValue]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "true" : "false");
      } catch {
        /* private mode — the flag just won't persist */
      }
      emit();
    },
    [key],
  );

  return [value, set];
}
