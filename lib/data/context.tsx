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
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { DataProvider } from "./provider";
import { InMemoryDataProvider } from "./in-memory-provider";
import { SupabaseDataProvider, type AccessStatus } from "./supabase-provider";
import { createClient } from "@/lib/supabase/client";

const DataProviderContext = createContext<DataProvider | null>(null);

/**
 * The swap point. `NEXT_PUBLIC_DATA_PROVIDER=supabase` selects the live,
 * Supabase-backed provider; anything else (or unset) uses the in-memory demo
 * provider, so tests and a no-network demo keep working. The Supabase provider
 * is only constructed in the browser (it needs a session/cookies); the throwaway
 * server render uses the in-memory provider.
 */
function makeProvider(): DataProvider {
  const useSupabase = process.env.NEXT_PUBLIC_DATA_PROVIDER === "supabase";
  if (useSupabase && typeof window !== "undefined") {
    return new SupabaseDataProvider(createClient());
  }
  return new InMemoryDataProvider();
}

export function DataProviderRoot({ children }: { children: ReactNode }) {
  const ref = useRef<DataProvider | null>(null);
  if (ref.current === null) ref.current = makeProvider();
  return (
    <DataProviderContext.Provider value={ref.current}>
      <AccessGate>{children}</AccessGate>
    </DataProviderContext.Provider>
  );
}

/** Live access status (loading / ok / no-session / not-member …). "ok" for the
 *  in-memory provider, which has no auth. */
export function useAccessStatus(): AccessStatus {
  const provider = useProvider();
  const isSupabase = provider instanceof SupabaseDataProvider;
  const subscribe = useMemo(() => provider.subscribe.bind(provider), [provider]);
  const get = () => (isSupabase ? (provider as SupabaseDataProvider).getAccessStatus() : "ok");
  // Server render: the in-memory demo is always "ok" (no auth); only the Supabase
  // provider is genuinely "loading" until it hydrates on the client.
  const serverSnapshot = (): AccessStatus => (isSupabase ? "loading" : "ok");
  return useSyncExternalStore(subscribe, get, serverSnapshot);
}

/**
 * Invite-only gate for the Supabase provider: routes the user to /signin when
 * there's no session and to /access-denied when signed in but not in
 * `memberships`. No-op for the in-memory demo. /signin and /access-denied are
 * never gated (so there's no redirect loop).
 */
function AccessGate({ children }: { children: ReactNode }) {
  const status = useAccessStatus();
  const pathname = usePathname();
  const router = useRouter();
  const exempt = pathname?.startsWith("/signin") || pathname?.startsWith("/access-denied");

  useEffect(() => {
    if (exempt) return;
    if (status === "no-session") {
      // Remember where the user was headed so sign-in can return them there.
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/signin${next}`);
    } else if (status === "not-member") router.replace("/access-denied");
  }, [status, exempt, pathname, router]);

  if (exempt) return <>{children}</>;
  if (status === "loading" || status === "no-session" || status === "not-member") {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", color: "#97a1a9", fontSize: 13 }}>
        {status === "loading" ? "Loading…" : "Redirecting…"}
      </div>
    );
  }
  return <>{children}</>;
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
