# Password Reset — Operator Runbook

## How the flow works

```
User visits /forgot-password
  → server action calls resetPasswordForEmail(email)  [no redirectTo arg]
  → Supabase sends email with link built from dashboard Site URL:
      {SiteURL}/auth/confirm?token_hash={hash}&type=recovery&next=/update-password
  → User clicks link → GET /auth/confirm
      • verifyOtp succeeds → sets pwreset-marker cookie (httpOnly, 10 min TTL)
      • redirects to /update-password
  → /update-password (server component) checks: session + pwreset-marker
      → missing either → redirect /forgot-password
      → both present → render password form
  → server action: updateUser({ password })
      • clears pwreset-marker cookie
      • signOut({ scope: "global" }) — all sessions on all devices invalidated
      → redirect /signin?reset=1
```

The reset link's host comes from the dashboard Site URL — it is never derived
from a request header. Host-poisoning attacks cannot change the link destination.

## Pre-merge checklist

These items are outside the codebase and must be done before the "Forgot
password?" link is added to the sign-in page:

### 1. Custom SMTP — HARD GATE

The built-in Supabase SMTP is rate-limited to ~2 emails/hour. Under that limit,
the reset flow cannot be tested and the feature is not usable in production.
Configure custom SMTP before any user-facing testing.

Supabase dashboard → **Project Settings → Auth → SMTP Settings**.

Recommended: Resend, Postmark, or SendGrid with a verified sending domain.

### 2. Email template

In the Supabase dashboard, go to **Authentication → Email Templates →
Reset Password**.

**Back up the current template first** (paste it into a doc — that's the
rollback).

Replace the template body with:

```html
<h2>Reset your password</h2>
<p>Follow the link below to choose a new password.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/update-password">
    Reset password
  </a>
</p>
```

### 3. Site URL

Supabase dashboard → **Project Settings → General → Site URL**.

Must be set to the production origin (e.g. `https://g12.alsama.org`). This
is where all reset links land. There is no preview-environment wildcard —
one Supabase project, one origin.

### 4. Redirect allow-list

Supabase dashboard → **Authentication → URL Configuration → Redirect URLs**.

Add exactly one entry: the production origin (matching the Site URL above).
No wildcards. The `/auth/confirm` handler uses no `redirectTo`, but Supabase
still checks the allow-list against the request origin.

### 5. Confirm Site URL matches the allow-list entry

Both must be the same string. A mismatch causes the OTP exchange to fail.

---

## Post-merge acceptance test (prod, against a real account)

Run these steps in order. Do them on prod — previews share the same Supabase
project and will consume a real email send.

1. Navigate to `/forgot-password`.
2. Enter your own email. Click "Send reset link". Confirm the "check your email"
   screen appears.
3. Check your inbox. Click the reset link. Confirm you land on `/update-password`.
4. Enter a new password (≥ 8 characters). Submit.
5. Confirm you land on `/signin?reset=1` and are signed out.
6. Sign in with the new password. Confirm access.
7. Attempt to navigate directly to `/update-password` without a marker cookie
   (open a new private window). Confirm redirect to `/forgot-password`.

---

## Post-acceptance: add the sign-in link (separate PR)

Only after step 6 above passes, open a one-line PR adding the "Forgot password?"
link to `app/signin/page.tsx`. This is the only thing that makes the feature
visible to users.

```tsx
<div style={{ textAlign: "center", marginTop: 14 }}>
  <Link href="/forgot-password" style={{ fontSize: 12, color: H.ink3, textDecoration: "none" }}>
    Forgot your password?
  </Link>
</div>
```

Add it after the submit button and before the "No account yet?" card.

---

## Notes

- **Password minimum:** The client UI enforces ≥ 8 characters. Confirm this
  matches the Supabase Auth password policy in
  **Authentication → Providers → Email → Minimum password length**.
  If the dashboard setting is higher, update the client check accordingly.

- **Resolved `@supabase/supabase-js` version:** The lockfile has two ranges
  (`^2.45.4` and `^2.43.4`). The resolved version in `node_modules` was not
  printed at audit time — run `node -e "console.log(require('./node_modules/@supabase/supabase-js/package.json').version)"` to confirm. `updateUser({ password })` needs ≥ 2.102.0 if `currentPassword` is added later; not required for this flow.

- **`/auth/confirm` is a Route Handler, not a page.** It does not go through
  `AccessGate`. The three new pages (`/forgot-password`, `/update-password`,
  `/auth/auth-code-error`) are added to the gate's exempt list.

- **Rollback:** Remove the template, disable the SMTP config. The routes remain
  deployed but unlinked (no "Forgot password?" link exists until the follow-up PR).
