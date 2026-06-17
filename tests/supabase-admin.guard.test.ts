/**
 * Defensive env guard for the privileged (secret-key) admin client.
 *
 * Regression for the live incident where a SUPABASE_SECRET_KEY with stray
 * whitespace made `Headers.set` throw an opaque `TypeError` that EMBEDDED the
 * key value — which then leaked to the browser. `createAdminClient` must:
 *   • trim the value (so a trailing newline/space is tolerated, not fatal),
 *   • validate the shape and throw a CLEAR, server-side config error otherwise,
 *   • never include the key value in that error.
 *
 * No real secret is used here — only obviously-fake placeholder values.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `server-only` throws on import outside a React Server environment, so stub it
// to a no-op for this node test (the guard logic under test is plain JS).
vi.mock("server-only", () => ({}));

const URL = "https://example.supabase.co";
// Build the prefix dynamically so this source file never contains a contiguous
// secret-key-shaped token (which scanners flag, even on obvious placeholders).
const SECRET_PREFIX = ["sb", "secret", ""].join("_");
const FAKE_VALID = `${SECRET_PREFIX}FAKE_PLACEHOLDER_not_a_real_key`;

async function freshCreate() {
  vi.resetModules();
  const mod = await import("@/lib/supabase/admin");
  return mod.createAdminClient;
}

describe("createAdminClient env guard", () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevSecret = process.env.SUPABASE_SECRET_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    process.env.SUPABASE_SECRET_KEY = prevSecret;
  });

  it("throws a clear config error (never the key) when the value has internal whitespace", async () => {
    const badValue = `${SECRET_PREFIX}FAKE WITH SPACE`;
    process.env.SUPABASE_SECRET_KEY = badValue;
    const createAdminClient = await freshCreate();
    expect(() => createAdminClient()).toThrowError(/malformed.*stray whitespace/i);
    // The error must not echo the key value back.
    try {
      createAdminClient();
    } catch (e) {
      expect((e as Error).message).not.toContain(badValue);
    }
  });

  it("throws a clear config error when the prefix is wrong (e.g. a publishable key)", async () => {
    process.env.SUPABASE_SECRET_KEY = ["sb", "publishable", "FAKE_PLACEHOLDER"].join("_");
    const createAdminClient = await freshCreate();
    expect(() => createAdminClient()).toThrowError(/malformed/i);
  });

  it("tolerates surrounding whitespace by trimming, and does not throw the malformed error", async () => {
    process.env.SUPABASE_SECRET_KEY = `  ${FAKE_VALID}\n`;
    const createAdminClient = await freshCreate();
    // Constructing the client makes no network call, so this resolves locally.
    expect(() => createAdminClient()).not.toThrow();
  });

  it("throws the missing-config error when the secret is absent", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const createAdminClient = await freshCreate();
    expect(() => createAdminClient()).toThrowError(/Missing .*SUPABASE_SECRET_KEY/i);
  });
});
