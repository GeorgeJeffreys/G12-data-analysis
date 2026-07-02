import "server-only";

/**
 * Schema drift guard — make "the live DB is behind the code" a legible,
 * actionable message instead of a raw Postgres string surfaced at the worst
 * moment (a failed import).
 *
 * Two entry points:
 *   * `checkSchemaHealth(admin)` calls the `schema_health()` RPC (migration 0020)
 *     and returns the drift report. The app can probe this proactively.
 *   * `schemaDriftMessage(rawError)` classifies a caught Postgres/PostgREST error
 *     and, when it looks like the missing-column/function class, returns an
 *     operator-facing "run migration NNNN in Supabase" message; otherwise null.
 */
import type { SupabaseAdminClient } from "@/lib/supabase/admin";

/** The migration that brings a drifted DB current (see supabase/migrations). */
export const BRING_CURRENT_MIGRATION = "0020_restore_ingest_delete.sql";

export interface SchemaHealth {
  ok: boolean;
  migration: string;
  missingColumns: string[];
  missingFunctions: string[];
}

const HEALTHY: SchemaHealth = { ok: true, migration: "0020", missingColumns: [], missingFunctions: [] };

/**
 * Probe the live schema for the columns/functions the code requires. Returns a
 * healthy report when the probe itself is unavailable (e.g. `schema_health` not
 * yet installed) so a missing probe never blocks — the ingest-time classifier is
 * the backstop in that case.
 */
export async function checkSchemaHealth(admin: SupabaseAdminClient): Promise<SchemaHealth> {
  const rpc = admin.rpc as unknown as (
    n: string,
    a?: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("schema_health");
  if (error || !data || typeof data !== "object") return HEALTHY;
  const d = data as {
    ok?: boolean;
    migration?: string;
    missing_columns?: string[];
    missing_functions?: string[];
  };
  return {
    ok: d.ok ?? true,
    migration: d.migration ?? "0020",
    missingColumns: d.missing_columns ?? [],
    missingFunctions: d.missing_functions ?? [],
  };
}

/** Human message for a drift report (only meaningful when `!ok`). */
export function describeSchemaHealth(h: SchemaHealth): string {
  const missing = [...h.missingColumns, ...h.missingFunctions];
  const detail = missing.length ? ` Missing: ${missing.join(", ")}.` : "";
  return `Database schema is out of date — run migration ${h.migration} in the Supabase SQL editor.${detail}`;
}

/**
 * Classify a raw DB error. Returns an actionable "run migration" message when the
 * error is the missing-column / missing-function class (the drift signature), or
 * null when it is an ordinary error the caller should surface as-is.
 *
 * Covers both Postgres (`column "x" of relation "y" does not exist`,
 * `function public.z(...) does not exist`) and PostgREST schema-cache misses
 * (`Could not find the function ... in the schema cache`, code PGRST202).
 */
export function schemaDriftMessage(rawError: string): string | null {
  const e = rawError.toLowerCase();
  const looksLikeDrift =
    /column .* of relation .* does not exist/.test(e) ||
    /column ".*" does not exist/.test(e) ||
    /function .* does not exist/.test(e) ||
    /could not find the function/.test(e) ||
    /in the schema cache/.test(e) ||
    e.includes("pgrst202");
  if (!looksLikeDrift) return null;
  return (
    `Database schema is out of date — run migration ${BRING_CURRENT_MIGRATION} ` +
    `in the Supabase SQL editor, then retry. (Underlying error: ${rawError})`
  );
}
