# archive/

Verified-dead / unused files, moved here during the production cutover instead of
being deleted. Nothing in this directory is imported by the app, and it is
excluded from the build, TypeScript typecheck (`tsconfig.json` → `exclude`), and
the test runner (`vitest.config.ts` → `test.exclude`). There is no ESLint config
in the repo today; `.eslintignore` already lists `archive/` for when one is added.

Each file was confirmed to have **zero import/reference sites** in `app/`,
`components/`, `lib/`, or `scripts/` before being moved (comment-only mentions
don't count as references).

## Contents

- `hf.jsx`, `hfA.jsx`, `hfB.jsx`, `hfBoundaries.jsx`, `hfDiag.jsx` — loose
  hi-fi design prototype files that used to sit at the repo root. Never imported;
  the shipped UI lives in `components/**` as `.tsx`.
- `design/` — the "Claude Design" working tree (hi-fi `.jsx` prototypes, `.html`
  mockups, screenshots). Reference material only; not part of the Next.js build.
  Some `components/ui/*` files cite these in comments ("ported from design/…") —
  those are historical notes, not imports.
- `diagnose-participant-collapse.sql` — a one-off diagnostic SQL for the resolved
  participant-collapse investigation (issue 700435). Dev-only, run by hand; it
  hard-coded staff emails, so it is retained here (out of the shipped tree)
  rather than in `scripts/`.

To restore any file, `git mv` it back to its original location.
