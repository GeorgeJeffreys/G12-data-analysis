/**
 * Minimal read-only Supabase client stand-in for exercising `hydrate`.
 *
 * Serves rows from an in-memory table map through the small slice of the
 * postgrest query-builder surface `supabase-hydrate.ts` actually uses:
 * `.from(table).select(...).eq(...).in(...).order(...).limit(...).maybeSingle()`,
 * each awaitable to `{ data, error }`. Filters/sorts are applied so the hydrate
 * path sees exactly what the database would return.
 */

type Row = Record<string, unknown>;

class Query implements PromiseLike<{ data: Row[] | Row | null; error: null }> {
  private rows: Row[];
  private single = false;
  constructor(rows: Row[]) {
    this.rows = [...rows];
  }
  select(_cols?: string): this {
    return this;
  }
  eq(col: string, val: unknown): this {
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    const set = new Set(vals);
    this.rows = this.rows.filter((r) => set.has(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    const asc = opts?.ascending ?? true;
    this.rows.sort((a, b) => {
      const x = a[col] as string | number | null;
      const y = b[col] as string | number | null;
      if (x === y) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : 1) * (asc ? 1 : -1);
    });
    return this;
  }
  limit(n: number): this {
    this.rows = this.rows.slice(0, n);
    return this;
  }
  maybeSingle(): this {
    this.single = true;
    return this;
  }
  then<TR = { data: Row[] | Row | null; error: null }, TE = never>(
    onfulfilled?: ((v: { data: Row[] | Row | null; error: null }) => TR | PromiseLike<TR>) | null,
    onrejected?: ((reason: unknown) => TE | PromiseLike<TE>) | null,
  ): Promise<TR | TE> {
    const data = this.single ? this.rows[0] ?? null : this.rows;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

export interface MockDb {
  [table: string]: Row[];
}

export function makeSupabaseReadClient(db: MockDb) {
  return {
    from(table: string) {
      return new Query(db[table] ?? []);
    },
    auth: {
      // hydrate() never calls auth; provided for completeness.
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    },
  };
}
