"use client";

/**
 * React wiring for the DataProvider. A single in-memory provider instance is
 * created on the client and shared through context. `useProviderData` subscribes
 * to provider changes via useSyncExternalStore so any exclusion / boundary /
 * lock recomputes and re-renders the screens that read it.
 *
 * Swapping in the Supabase provider is a one-line change here (construct the
 * other implementation) — no component changes.
 */

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { DataProvider } from "./provider";
import { InMemoryDataProvider } from "./in-memory-provider";

const DataProviderContext = createContext<DataProvider | null>(null);

export function DataProviderRoot({ children }: { children: ReactNode }) {
  const ref = useRef<DataProvider | null>(null);
  if (ref.current === null) ref.current = new InMemoryDataProvider();
  return (
    <DataProviderContext.Provider value={ref.current}>
      {children}
    </DataProviderContext.Provider>
  );
}

export function useProvider(): DataProvider {
  const ctx = useContext(DataProviderContext);
  if (!ctx) throw new Error("useProvider must be used within <DataProviderRoot>");
  return ctx;
}

/**
 * Read a value from the provider and re-render when the provider changes.
 * `selector` should be a pure read (e.g. `(p) => p.getReview(cycleId, aId)`).
 * `deps` are the selector's inputs (e.g. `[cycleId, assessmentId]`) so the value
 * recomputes when they change as well as when the provider's version bumps.
 */
export function useProviderData<T>(
  selector: (provider: DataProvider) => T,
  deps: ReadonlyArray<unknown> = [],
): T {
  const provider = useProvider();
  const subscribe = useMemo(() => provider.subscribe.bind(provider), [provider]);
  const depsKey = JSON.stringify(deps);

  // Cache so getSnapshot returns a stable reference unless the provider version
  // or the selector inputs change (required by useSyncExternalStore).
  const cache = useRef<{ version: number; depsKey: string; value: T } | null>(null);
  const getSnapshot = () => {
    const version = provider.getVersion();
    if (!cache.current || cache.current.version !== version || cache.current.depsKey !== depsKey) {
      cache.current = { version, depsKey, value: selector(provider) };
    }
    return cache.current.value;
  };

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
