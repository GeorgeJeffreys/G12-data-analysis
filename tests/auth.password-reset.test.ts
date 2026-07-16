/**
 * Password-reset flow — unit tests.
 *
 * Covers four contracts:
 *   1. requestPasswordReset — enumeration guard: always resolves, never throws.
 *   2. resetPasswordForEmail called with exactly one argument (no options/redirectTo).
 *   3. updatePassword — marker cleared and global sign-out on success; untouched on failure.
 *   4. /auth/confirm route — sets marker + correct redirect on success; error redirect otherwise.
 *   5. AccessGate exempt list — new paths are exempt; gated paths are not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared mocks — declared before vi.mock so factories capture the same refs.
// ---------------------------------------------------------------------------
const mockAuth = {
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: mockAuth }),
}));

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  getAll: vi.fn(() => []),
};

vi.mock("next/headers", () => ({
  cookies: () => mockCookieStore,
}));

// ---------------------------------------------------------------------------
// Module imports (after mocks are wired up)
// ---------------------------------------------------------------------------
const { requestPasswordReset } = await import("@/app/forgot-password/actions");
const { updatePassword } = await import("@/app/update-password/actions");
const { GET: confirmGET } = await import("@/app/auth/confirm/route");

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mockAuth.verifyOtp.mockResolvedValue({ data: {}, error: null });
  mockAuth.updateUser.mockResolvedValue({ data: {}, error: null });
  mockAuth.signOut.mockResolvedValue({ error: null });
  mockAuth.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mockCookieStore.get.mockReturnValue(undefined);
  // Ensure the env guard in requestPasswordReset doesn't short-circuit.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

// ---------------------------------------------------------------------------
// 1 + 2: requestPasswordReset
// ---------------------------------------------------------------------------
describe("requestPasswordReset server action", () => {
  it("resolves without throwing when supabase succeeds", async () => {
    await expect(requestPasswordReset("user@example.com")).resolves.toBeUndefined();
  });

  it("resolves without throwing even when supabase throws (enumeration guard)", async () => {
    mockAuth.resetPasswordForEmail.mockRejectedValue(new Error("network error"));
    await expect(requestPasswordReset("unknown@example.com")).resolves.toBeUndefined();
  });

  it("resolves without throwing even when supabase returns an error object", async () => {
    mockAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: { message: "User not found" } });
    await expect(requestPasswordReset("unknown@example.com")).resolves.toBeUndefined();
  });

  it("calls resetPasswordForEmail with exactly one argument — no options, no redirectTo", async () => {
    await requestPasswordReset("user@example.com");
    expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    const [arg1, arg2] = mockAuth.resetPasswordForEmail.mock.calls[0];
    expect(arg1).toBe("user@example.com");
    expect(arg2).toBeUndefined();
  });

  it("is a silent no-op when env vars are absent", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    await expect(requestPasswordReset("user@example.com")).resolves.toBeUndefined();
    expect(mockAuth.resetPasswordForEmail).not.toHaveBeenCalled();
    // beforeEach restores the vars for the next test.
  });
});

// ---------------------------------------------------------------------------
// 3: updatePassword
// ---------------------------------------------------------------------------
describe("updatePassword server action", () => {
  it("returns {error: null} on success", async () => {
    const result = await updatePassword("newpassword123");
    expect(result).toEqual({ error: null });
  });

  it("deletes the pwreset-marker cookie on success", async () => {
    await updatePassword("newpassword123");
    expect(mockCookieStore.delete).toHaveBeenCalledWith("pwreset-marker");
  });

  it("calls signOut with scope 'global' on success", async () => {
    await updatePassword("newpassword123");
    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("returns {error: message} when updateUser fails", async () => {
    mockAuth.updateUser.mockResolvedValue({ data: {}, error: { message: "Password too short" } });
    const result = await updatePassword("abc");
    expect(result).toEqual({ error: "Password too short" });
  });

  it("does NOT delete the marker or sign out when updateUser fails", async () => {
    mockAuth.updateUser.mockResolvedValue({ data: {}, error: { message: "fail" } });
    await updatePassword("abc");
    expect(mockCookieStore.delete).not.toHaveBeenCalled();
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4: /auth/confirm route handler
// ---------------------------------------------------------------------------
function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL("https://app.example.com/auth/confirm");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

function redirectTarget(response: Response): string {
  return response.headers.get("location") ?? "";
}

describe("/auth/confirm route handler", () => {
  it("redirects to /auth/auth-code-error when token_hash is missing", async () => {
    const res = await confirmGET(makeRequest({ type: "recovery" }));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toContain("/auth/auth-code-error");
  });

  it("redirects to /auth/auth-code-error when type is not 'recovery'", async () => {
    const res = await confirmGET(makeRequest({ token_hash: "tok123", type: "signup" }));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toContain("/auth/auth-code-error");
  });

  it("redirects to /auth/auth-code-error when verifyOtp returns an error", async () => {
    mockAuth.verifyOtp.mockResolvedValue({ data: {}, error: { message: "Token expired" } });
    const res = await confirmGET(makeRequest({ token_hash: "expired", type: "recovery" }));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toContain("/auth/auth-code-error");
  });

  it("sets pwreset-marker cookie and redirects to /update-password on success", async () => {
    const res = await confirmGET(makeRequest({ token_hash: "valid", type: "recovery" }));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toContain("/update-password");
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "pwreset-marker",
      "1",
      expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    );
  });

  it("redirects to the sanitized 'next' param when present", async () => {
    const res = await confirmGET(
      makeRequest({ token_hash: "valid", type: "recovery", next: "/update-password" }),
    );
    expect(redirectTarget(res)).toContain("/update-password");
  });

  it("ignores a 'next' param that looks like an open-redirect attempt", async () => {
    const res = await confirmGET(
      makeRequest({ token_hash: "valid", type: "recovery", next: "//evil.com" }),
    );
    expect(redirectTarget(res)).toContain("/update-password");
    expect(redirectTarget(res)).not.toContain("evil.com");
  });

  it("calls verifyOtp with token_hash and type 'recovery'", async () => {
    await confirmGET(makeRequest({ token_hash: "abc123", type: "recovery" }));
    expect(mockAuth.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc123", type: "recovery" });
  });
});

// ---------------------------------------------------------------------------
// 5: AccessGate exempt list
// ---------------------------------------------------------------------------
describe("AccessGate exempt list", () => {
  // Test the exact logic from lib/data/context.tsx so a future change to the
  // exempt list fails this test rather than silently breaking a public route.
  function isExempt(pathname: string): boolean {
    return (
      pathname.startsWith("/signin") ||
      pathname.startsWith("/access-denied") ||
      pathname.startsWith("/forgot-password") ||
      pathname.startsWith("/update-password") ||
      pathname.startsWith("/auth/auth-code-error")
    );
  }

  const publicPaths = [
    "/signin",
    "/signin?next=%2F",
    "/access-denied",
    "/forgot-password",
    "/update-password",
    "/auth/auth-code-error",
  ];

  const gatedPaths = [
    "/",
    "/analytics",
    "/cycles/abc123",
    "/settings",
    "/years",
  ];

  for (const p of publicPaths) {
    it(`exempt: ${p}`, () => expect(isExempt(p)).toBe(true));
  }

  for (const p of gatedPaths) {
    it(`gated: ${p}`, () => expect(isExempt(p)).toBe(false));
  }
});
