/**
 * Audit-log overrides after P2 — gated on the `override` PERMISSION (the P1
 * matrix), not the old strictly-higher `canOverride` hierarchy. Exercised through
 * the REAL provider on the genuine seeded cohort.
 *
 * In the default matrix only `admin` holds `override`, so:
 *  - An admin CAN override ANY decider's decision — a team member, an analyst, and
 *    (now that the flat permission replaces the equal-role block) another admin.
 *  - A role WITHOUT the `override` permission (analyst, team member by default)
 *    cannot override anything.
 *  - The Audit & overrides view exposes `canOverride` (top-level + per-row) straight
 *    from the viewer's `override` permission; `decidedByRole` remains as a label.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { CurrentUser } from "@/lib/data/types";

const CYCLE = "may-2026";

const TEAM: CurrentUser = { id: "m-sami", name: "Omar Reviewer", initials: "SH", role: "reviewer" };
const ANALYST: CurrentUser = { id: "m-dana", name: "Dana Aziz", initials: "DA", role: "analyst" };
const ADMIN: CurrentUser = { id: "m-rana", name: "Nadia Admin", initials: "RM", role: "lead_admin" };
const ADMIN_2: CurrentUser = { id: "m-lina", name: "Lina Saad", initials: "LS", role: "lead_admin" };

function pickItem(p: InMemoryDataProvider) {
  for (const a of p.getGrades(CYCLE)!.assessments) {
    const review = p.getReview(CYCLE, a.id);
    const item = review?.items[0];
    if (item) return { aid: a.id, itemId: item.id };
  }
  throw new Error("no assessment/item in the seed");
}
const excluded = (p: InMemoryDataProvider, aid: string, itemId: string) =>
  p.getReview(CYCLE, aid)!.items.find((i) => i.id === itemId)!.excluded;
const auditLen = (p: InMemoryDataProvider) => p.getAuditLog(CYCLE, "all", "").entries.length;

describe("an admin overrides any decider (flat `override` permission)", () => {
  it("re-includes a team member's exclusion and audits the override", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);

    p.setCurrentUser(TEAM);
    p.setItemExcluded(CYCLE, aid, itemId, true, "ambiguous wording");
    expect(excluded(p, aid, itemId)).toBe(true);

    p.setCurrentUser(ADMIN);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "Re-included after admin review");
    expect(excluded(p, aid, itemId)).toBe(false);

    const e = p.getAuditLog(CYCLE, "all", "").entries[0]!;
    expect(e.type).toBe("override");
    expect(e.isOverride).toBe(true);
    expect(e.actorName).toBe("Nadia Admin");
    expect(e.priorActor).toBe("Omar Reviewer");
    expect(e.reason).toBe("Re-included after admin review");
  });

  it("overrides an analyst's exclusion", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ANALYST);
    p.setItemExcluded(CYCLE, aid, itemId, true, "analyst exclusion");

    p.setCurrentUser(ADMIN);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "Admin re-included after appeal");
    expect(excluded(p, aid, itemId)).toBe(false);
    expect(p.getAuditLog(CYCLE, "all", "").entries[0]!.type).toBe("override");
  });

  it("overrides ANOTHER admin's exclusion (flat permission — no equal-role block)", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ADMIN);
    p.setItemExcluded(CYCLE, aid, itemId, true, "admin exclusion");

    p.setCurrentUser(ADMIN_2);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "Second admin re-included");
    expect(excluded(p, aid, itemId)).toBe(false); // now allowed
    expect(p.getAuditLog(CYCLE, "all", "").entries[0]!.type).toBe("override");
  });
});

describe("roles without the `override` permission cannot override", () => {
  it("an analyst CANNOT override a team member's exclusion", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(TEAM);
    p.setItemExcluded(CYCLE, aid, itemId, true, "team member exclusion");
    const before = auditLen(p);

    p.setCurrentUser(ANALYST);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "analyst trying to override");
    expect(excluded(p, aid, itemId)).toBe(true); // unchanged
    expect(auditLen(p)).toBe(before); // nothing audited
  });

  it("a team member CANNOT override an analyst's exclusion", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ANALYST);
    p.setItemExcluded(CYCLE, aid, itemId, true, "analyst exclusion");
    const before = auditLen(p);

    p.setCurrentUser(TEAM);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "team member trying to override");
    expect(excluded(p, aid, itemId)).toBe(true);
    expect(auditLen(p)).toBe(before);
  });
});

describe("mark-adjustment overrides follow the same `override` permission", () => {
  function pickCell(p: InMemoryDataProvider) {
    const comp = p.getComposition(CYCLE)!;
    return comp.students
      .flatMap((s) => s.subjects.map((sj) => ({ pid: s.participantId, aid: sj.assessmentId, total: sj.total, max: sj.max })))
      .find((t) => t.total >= 8 && t.total <= t.max - 6)!;
  }

  it("an admin reverts a team member's adjustment; an analyst cannot", () => {
    // Admin over team member — allowed.
    const p1 = new InMemoryDataProvider();
    const c1 = pickCell(p1);
    p1.setCurrentUser(TEAM);
    p1.adjustStudentMark(CYCLE, c1.pid, c1.aid, c1.total + 2, "team member remark");
    p1.setCurrentUser(ADMIN);
    p1.overrideMarkAdjustment(CYCLE, c1.pid, c1.aid, null, "Admin reverted: appeal not upheld");
    const base = JSON.stringify(new InMemoryDataProvider().getGrades(CYCLE)!.rows);
    expect(JSON.stringify(p1.getGrades(CYCLE)!.rows)).toBe(base);
    expect(p1.getAuditLog(CYCLE, "all", "").entries[0]!.type).toBe("override");

    // Analyst (no override permission) — rejected.
    const p2 = new InMemoryDataProvider();
    const c2 = pickCell(p2);
    p2.setCurrentUser(TEAM);
    p2.adjustStudentMark(CYCLE, c2.pid, c2.aid, c2.total + 2, "team member remark");
    const moved = JSON.stringify(p2.getGrades(CYCLE)!.rows);
    const before = auditLen(p2);
    p2.setCurrentUser(ANALYST);
    p2.overrideMarkAdjustment(CYCLE, c2.pid, c2.aid, null, "analyst trying to revert");
    expect(JSON.stringify(p2.getGrades(CYCLE)!.rows)).toBe(moved); // unchanged
    expect(auditLen(p2)).toBe(before); // nothing audited
  });
});

describe("Audit & overrides view — canOverride reflects the `override` permission", () => {
  it("every row is overridable to an admin, and the setter's tier is labelled", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);

    // A team member excludes one item; an admin excludes a second.
    p.setCurrentUser(TEAM);
    p.setItemExcluded(CYCLE, aid, itemId, true, "team member exclusion");
    const second = (() => {
      for (const a of p.getGrades(CYCLE)!.assessments) {
        const it = p.getReview(CYCLE, a.id)!.items.find((i) => i.id !== itemId);
        if (it) return { aid: a.id, itemId: it.id };
      }
      throw new Error("need a second item");
    })();
    p.setCurrentUser(ADMIN);
    p.setItemExcluded(CYCLE, second.aid, second.itemId, true, "admin exclusion");

    // Viewed AS an admin: both rows overridable (incl. the admin-set one), tiers labelled.
    const view = p.getOverrideView(CYCLE);
    expect(view.canOverride).toBe(true);
    const teamRow = view.decisions.find((d) => d.itemId === itemId)!;
    const adminRow = view.decisions.find((d) => d.itemId === second.itemId)!;
    expect(teamRow.decidedByRole).toBe("G12 team member");
    expect(adminRow.decidedByRole).toBe("Admin");
    expect(teamRow.canOverride).toBe(true);
    expect(adminRow.canOverride).toBe(true); // flat permission: even an admin-set row
  });

  it("a role without the override permission sees no overridable rows", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ADMIN);
    p.setItemExcluded(CYCLE, aid, itemId, true, "admin exclusion");

    for (const u of [ANALYST, TEAM]) {
      p.setCurrentUser(u);
      const view = p.getOverrideView(CYCLE);
      expect(view.canOverride).toBe(false);
      expect(view.decisions.every((d) => d.canOverride === false)).toBe(true);
    }
  });
});
