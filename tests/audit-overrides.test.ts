/**
 * Audit trail + reversible / overridable pipeline actions (P4), through the REAL
 * provider over the genuine seeded cohort.
 *
 * Covers (per the task's verification list):
 *  - An override by an AUTHORISED user (lead_admin) succeeds, flips the effective
 *    state, and writes the correct audit entries (override-typed, naming who
 *    overrode whom + the reason + a timestamp).
 *  - An UNAUTHORISED override (a reviewer) is rejected — the state is unchanged and
 *    nothing is audited. (The live path enforces this server-side via the RPC's
 *    lead_admin check; see migration.audit-overrides.test.ts.)
 *  - A grade-bearing override produces the SAME engine result as performing the
 *    action directly (parity on the real seeded cohort) — proving the override
 *    goes through the full engine, not a shortcut.
 *  - The D3 distinction safeguard still applies after an override recompute.
 *  - The Audit & overrides view surfaces the current effective state with
 *    override provenance.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { CurrentUser } from "@/lib/data/types";

const CYCLE = "may-2026";

const REVIEWER_A: CurrentUser = { id: "m-sami", name: "Sami Haddad", initials: "SH", role: "reviewer" };
const ADMIN_B: CurrentUser = { id: "m-rana", name: "Rana Mansour", initials: "RM", role: "lead_admin" };
const VIEWER_C: CurrentUser = { id: "m-zoe", name: "Zoe Khoury", initials: "ZK", role: "viewer" };

/** First assessment with at least one item, and that item's id. */
function pickItem(p: InMemoryDataProvider) {
  for (const a of p.getGrades(CYCLE)!.assessments) {
    const review = p.getReview(CYCLE, a.id);
    const item = review?.items[0];
    if (item) return { aid: a.id, itemId: item.id };
  }
  throw new Error("no assessment/item in the seed");
}

describe("override — authorised user re-includes another user's exclusion", () => {
  it("flips the effective state and writes an override audit entry naming who overrode whom", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);

    // Reviewer A excludes the item.
    p.setCurrentUser(REVIEWER_A);
    p.setItemExcluded(CYCLE, aid, itemId, true, "ambiguous wording");
    expect(p.getReview(CYCLE, aid)!.items.find((i) => i.id === itemId)!.excluded).toBe(true);

    // Admin B overrides — re-includes it.
    p.setCurrentUser(ADMIN_B);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "Re-included after appeal upheld");

    // Effective state flipped back to active.
    expect(p.getReview(CYCLE, aid)!.items.find((i) => i.id === itemId)!.excluded).toBe(false);

    // Newest audit entry is the override: typed, names actor + prior actor + reason + time.
    const e = p.getAuditLog(CYCLE, "all", "").entries[0]!;
    expect(e.type).toBe("override");
    expect(e.isOverride).toBe(true);
    expect(e.actorName).toBe("Rana Mansour");
    expect(e.priorActor).toBe("Sami Haddad");
    expect(e.reason).toBe("Re-included after appeal upheld");
    expect(e.detail).toContain("Sami Haddad");
    expect(Number.isNaN(Date.parse(e.ts))).toBe(false);
  });
});

describe("override — unauthorised user is rejected (no state change, nothing audited)", () => {
  it("a reviewer cannot override an exclusion", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(REVIEWER_A);
    p.setItemExcluded(CYCLE, aid, itemId, true, "negative discrimination");
    const auditBefore = p.getAuditLog(CYCLE, "all", "").entries.length;

    // Reviewer A is NOT authorised to override — the call is a no-op.
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "trying to re-include");
    expect(p.getReview(CYCLE, aid)!.items.find((i) => i.id === itemId)!.excluded).toBe(true);
    expect(p.getAuditLog(CYCLE, "all", "").entries.length).toBe(auditBefore);

    // A viewer is likewise rejected.
    p.setCurrentUser(VIEWER_C);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "trying again");
    expect(p.getReview(CYCLE, aid)!.items.find((i) => i.id === itemId)!.excluded).toBe(true);
  });

  it("an override with a blank reason is a no-op", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setItemExcluded(CYCLE, aid, itemId, true, "x");
    p.setCurrentUser(ADMIN_B);
    const auditBefore = p.getAuditLog(CYCLE, "all", "").entries.length;
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "   ");
    expect(p.getReview(CYCLE, aid)!.items.find((i) => i.id === itemId)!.excluded).toBe(true);
    expect(p.getAuditLog(CYCLE, "all", "").entries.length).toBe(auditBefore);
  });
});

describe("override parity — same engine result as performing the action directly", () => {
  it("re-including via an override yields identical grades to a direct re-include", () => {
    const { aid, itemId } = pickItem(new InMemoryDataProvider());

    // Direct: exclude then re-include via the normal item-review action.
    const direct = new InMemoryDataProvider();
    direct.setItemExcluded(CYCLE, aid, itemId, true, "x");
    direct.setItemExcluded(CYCLE, aid, itemId, false, "y");
    const gDirect = JSON.stringify(direct.getGrades(CYCLE)!.rows);

    // Override: reviewer excludes, admin re-includes via the override path.
    const ov = new InMemoryDataProvider();
    ov.setCurrentUser(REVIEWER_A);
    ov.setItemExcluded(CYCLE, aid, itemId, true, "x");
    ov.setCurrentUser(ADMIN_B);
    ov.overrideItemExclusion(CYCLE, aid, itemId, false, "y");
    const gOverride = JSON.stringify(ov.getGrades(CYCLE)!.rows);

    expect(gOverride).toBe(gDirect);

    // …and both equal the untouched baseline (exclude→re-include is a clean round-trip).
    const baseline = JSON.stringify(new InMemoryDataProvider().getGrades(CYCLE)!.rows);
    expect(gOverride).toBe(baseline);
  });

  it("the D3 distinction safeguard still applies after an override recompute", () => {
    const p = new InMemoryDataProvider();
    // Drop every cut so the cohort reaches the Distinction level-pattern; the
    // score-based D3 cap then gates Distinction (mirrors grading.distinction).
    for (const a of p.getGrades(CYCLE)!.assessments) p.setBoundary(CYCLE, a.id, { cuts: [5, 3, 1] });
    const distinction = p.getGrades(CYCLE)!.awardLevels[0]!;
    const capped = p.getGrades(CYCLE)!.rows.find((r) => r.distinctionCap)!;
    expect(capped.award).not.toBe(distinction);

    // An item-exclusion override changes the scored item set but not D3 correctness,
    // so the safeguard must still deny Distinction through the recompute.
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ADMIN_B);
    p.overrideItemExclusion(CYCLE, aid, itemId, true, "override-exclude under check-in");

    const after = p.getGrades(CYCLE)!.rows.find((r) => r.id === capped.id)!;
    expect(after.distinctionCap).toBeTruthy();
    expect(after.award).not.toBe(distinction);
  });
});

describe("override — manual mark adjustment can be reverted by an authorised user", () => {
  it("an admin reverts a reviewer's adjustment; the grade reverts and the override is audited", () => {
    const p = new InMemoryDataProvider();
    const comp = p.getComposition(CYCLE)!;
    const target = comp.students
      .flatMap((s) => s.subjects.map((sj) => ({ pid: s.participantId, aid: sj.assessmentId, total: sj.total, max: sj.max })))
      .find((t) => t.total >= 8 && t.total <= t.max - 6)!;

    // Reviewer A makes a manual adjustment.
    p.setCurrentUser(REVIEWER_A);
    p.adjustStudentMark(CYCLE, target.pid, target.aid, target.total + 2, "remark");
    const baseRows = JSON.stringify(new InMemoryDataProvider().getGrades(CYCLE)!.rows);
    expect(JSON.stringify(p.getGrades(CYCLE)!.rows)).not.toBe(baseRows); // grade moved

    // Admin B overrides — reverts the adjustment.
    p.setCurrentUser(ADMIN_B);
    p.overrideMarkAdjustment(CYCLE, target.pid, target.aid, null, "Reverted: appeal not upheld");

    // Grade is back to baseline (parity with a direct removal).
    expect(JSON.stringify(p.getGrades(CYCLE)!.rows)).toBe(baseRows);
    const e = p.getAuditLog(CYCLE, "all", "").entries[0]!;
    expect(e.type).toBe("override");
    expect(e.priorActor).toBe("Sami Haddad");
    expect(e.reason).toBe("Reverted: appeal not upheld");
  });
});

describe("audit & overrides view — current effective state with provenance", () => {
  it("lists effective decisions and flags those that are the result of an override", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);

    // Reviewer A excludes; the decision is in effect, not yet an override.
    p.setCurrentUser(REVIEWER_A);
    p.setItemExcluded(CYCLE, aid, itemId, true, "ambiguous");
    let view = p.getOverrideView(CYCLE);
    const before = view.decisions.find((d) => d.itemId === itemId)!;
    expect(before.decidedBy).toBe("Sami Haddad");
    expect(before.override).toBeFalsy();
    expect(view.canOverride).toBe(false); // reviewer can't override

    // Admin B overrides — re-EXCLUDES with a fresh reason (state stays excluded but
    // is now the result of an override, so it remains visible with provenance).
    p.setCurrentUser(ADMIN_B);
    p.overrideItemExclusion(CYCLE, aid, itemId, true, "Confirmed exclusion at check-in");
    view = p.getOverrideView(CYCLE);
    expect(view.canOverride).toBe(true);
    const after = view.decisions.find((d) => d.itemId === itemId)!;
    expect(after.override).toBeTruthy();
    expect(after.override!.by).toBe("Rana Mansour");
    expect(after.override!.priorActor).toBe("Sami Haddad");
    expect(after.override!.reason).toBe("Confirmed exclusion at check-in");
    expect(view.counts.overridden).toBeGreaterThanOrEqual(1);
  });
});
