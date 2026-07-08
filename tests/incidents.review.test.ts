/**
 * Provider wiring for the Incident Adjustments REVIEW surface + apply (02b).
 *
 * Verifies the end-to-end review model: base + capped adjustment + adjusted total
 * are decomposable; per-code and per-student caps are surfaced; unclassified /
 * unmatched incidents grant zero and are surfaced; committing is admin-only and an
 * explicit action; and — critically — the BASE score is never altered by the layer
 * (it reconciles 1:1 with the raw oracle whether or not adjustments are applied).
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { CurrentUser } from "@/lib/data/types";

const VIEWER: CurrentUser = { id: "v1", name: "Vera", initials: "V", role: "viewer" };

function liveId(p: InMemoryDataProvider): string {
  return p.listCycles()[0]!.id;
}

describe("incident review — model assembly", () => {
  it("is empty until incidents are imported", () => {
    const p = new InMemoryDataProvider();
    const review = p.getIncidentReview(liveId(p))!;
    expect(review).not.toBeNull();
    expect(review.counts.incidents).toBe(0);
    expect(review.students).toHaveLength(0);
  });

  it("decomposes every student into base + capped adjustment = adjusted", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    p.loadSampleIncidentRows(id);
    const review = p.getIncidentReview(id)!;
    expect(review.counts.incidents).toBeGreaterThan(0);
    for (const s of [...review.students, ...review.unmatched]) {
      expect(s.adjusted).toBeCloseTo(s.base + s.adjustment, 6);
      expect(s.adjustment).toBeGreaterThanOrEqual(0); // add-only
      const sum = s.contributions.reduce((t, c) => t + c.marks, 0);
      // The applied adjustment never exceeds the (per-code-capped) contribution sum.
      expect(s.adjustment).toBeLessThanOrEqual(sum + 1e-9);
    }
  });

  it("surfaces per-code and per-student cap hits, and unclassified / unmatched rows", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    p.loadSampleIncidentRows(id);
    const review = p.getIncidentReview(id)!;
    expect(review.counts.perCodeCapHits).toBeGreaterThan(0);
    expect(review.counts.perStudentCapHits).toBeGreaterThan(0);
    expect(review.counts.unclassified).toBeGreaterThan(0);
    expect(review.unmatched.length).toBeGreaterThan(0);
    // A student who hit the per-student cap has adjustment < uncapped total.
    const capped = review.students.find((s) => s.perStudentCapHit)!;
    expect(capped.adjustment).toBeLessThan(capped.uncappedAdjustment);
    if (review.perStudentCap !== null) expect(capped.adjustment).toBeLessThanOrEqual(review.perStudentCap);
  });

  it("grants zero for unclassified incidents (never applied)", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    p.loadSampleIncidentRows(id);
    const review = p.getIncidentReview(id)!;
    for (const s of review.students) {
      for (const c of s.contributions) {
        if (c.status !== "ok" || !c.code) expect(c.marks).toBe(0);
      }
    }
  });
});

describe("incident review — base scores are untouched by the layer", () => {
  it("the composition base total is identical before and after apply", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    const baseBefore = p.getComposition(id)!.students.map((s) => ({ id: s.participantId, total: s.overall.total }));

    p.loadSampleIncidentRows(id);
    p.applyIncidentAdjustments(id);

    const baseAfter = p.getComposition(id)!.students.map((s) => ({ id: s.participantId, total: s.overall.total }));
    expect(baseAfter).toEqual(baseBefore); // the engine base is never mutated by incidents
    // The review still exposes base separately from the adjustment.
    const review = p.getIncidentReview(id)!;
    for (const s of review.students) {
      const base = baseBefore.find((b) => b.id === s.participantId);
      if (base) expect(s.base).toBeCloseTo(base.total, 2);
    }
  });
});

describe("incident review — commit gated on the `adjust` permission, explicit", () => {
  it("apply/revert works, and denial follows the matrix (not the role)", () => {
    const p = new InMemoryDataProvider();
    const id = liveId(p);
    p.loadSampleIncidentRows(id);
    expect(p.getIncidentReview(id)!.applied).toBe(false); // not automatic on import

    p.applyIncidentAdjustments(id);
    let review = p.getIncidentReview(id)!;
    expect(review.applied).toBe(true);
    expect(review.appliedBy).toBeTruthy();

    p.unapplyIncidentAdjustments(id);
    expect(p.getIncidentReview(id)!.applied).toBe(false);

    // Under the DEFAULT matrix a team member (viewer) holds `adjust`, so they can
    // now commit — the P2 behaviour change (this used to be admin-only).
    const v = new InMemoryDataProvider();
    v.setCurrentUser(VIEWER);
    const vid = liveId(v);
    v.loadSampleIncidentRows(vid);
    expect(v.getIncidentReview(vid)!.canApply).toBe(true);
    v.applyIncidentAdjustments(vid);
    expect(v.getIncidentReview(vid)!.applied).toBe(true);

    // The gate reads the MATRIX: ungrant `adjust` from team_member and the same
    // viewer is denied (canApply=false, apply is a no-op).
    const d = new InMemoryDataProvider();
    d.setCurrentUser(VIEWER);
    d.applyRolePermissions([
      { tier: "team_member", permission: "view", granted: true },
      { tier: "team_member", permission: "clean", granted: true },
      // adjust intentionally omitted → not granted
    ]);
    const did = liveId(d);
    expect(d.getIncidentReview(did)!.canApply).toBe(false);
    d.applyIncidentAdjustments(did);
    expect(d.getIncidentReview(did)!.applied).toBe(false); // no-op
  });

  it("a viewer can still VIEW the review surface (all roles)", () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(VIEWER);
    const id = liveId(p);
    p.loadSampleIncidentRows(id);
    const review = p.getIncidentReview(id)!;
    expect(review.counts.incidents).toBeGreaterThan(0);
    expect(review.students.length).toBeGreaterThan(0);
  });
});
