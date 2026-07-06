/**
 * Per-cycle "current step" memory for the Critical Path.
 *
 * WHY THIS EXISTS (Bug 3). Clicking "Critical Path" from a step page routed to
 * `/cycles/:id`, which redirected to the cycle's FIRST INCOMPLETE stage
 * (`doNext.href`) — almost always Clean. So a user working on, say, Cut scores
 * was bounced back to Clean every time they touched the tab, losing their place.
 *
 * The fix records the step the user last had open (per cycle) and lets the Critical
 * Path entry route there instead. This is UI navigation memory — a convenience, not
 * a grade-bearing decision — so it lives in `localStorage` (durable across reloads,
 * no migration, no server round-trip). When nothing is recorded we fall back to the
 * cycle's `doNext.href`, so a freshly-opened cycle still lands on its next action.
 */

const KEY_PREFIX = "g12:lastStep:";

/** SSR / private-mode safe accessor — never throws, just no-ops when unavailable. */
function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Record the pipeline stage index the user currently has open for a cycle. Called
 * from the shell as each Critical Path step mounts, so the memory always reflects
 * the furthest place the user has actually navigated to.
 */
export function recordCycleStep(cycleId: string, stageIndex: number): void {
  const s = store();
  if (!s || !Number.isFinite(stageIndex)) return;
  try {
    s.setItem(KEY_PREFIX + cycleId, String(Math.max(0, Math.trunc(stageIndex))));
  } catch {
    /* quota / disabled — memory is best-effort */
  }
}

/**
 * The last stage index the user had open for a cycle, or null when none is
 * recorded (fresh cycle / cleared storage / SSR). Callers fall back to the cycle's
 * `doNext` step in that case.
 */
export function readCycleStep(cycleId: string): number | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY_PREFIX + cycleId);
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
