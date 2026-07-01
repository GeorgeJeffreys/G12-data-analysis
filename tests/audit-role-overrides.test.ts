/**
 * Prompt 06 — audit-log overrides gated on the canonical STRICTLY-HIGHER rule
 * (`canOverride`), not a flat lead_admin gate. Complements audit-overrides.test.ts
 * (which covers the admin-over-reviewer happy path + parity/D3) by exercising the
 * full hierarchy through the REAL provider on the genuine seeded cohort:
 *
 *   admin (lead_admin) > data analyst (analyst) > G12 team member (reviewer/viewer)
 *
 *  - Data analyst CAN override a team member's decision.
 *  - Data analyst CANNOT override an admin's or another analyst's decision.
 *  - Admin CANNOT override another admin's decision (equal role).
 *  - The Audit & overrides view carries a per-decision `canOverride` + the setter's
 *    role tier so the UI can show/enable Override exactly where the rule allows.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { CurrentUser } from "@/lib/data/types";

const CYCLE = "may-2026";

const TEAM: CurrentUser = { id: "m-sami", name: "Sami Haddad", initials: "SH", role: "reviewer" };
const ANALYST: CurrentUser = { id: "m-dana", name: "Dana Aziz", initials: "DA", role: "analyst" };
const ANALYST_2: CurrentUser = { id: "m-omar", name: "Omar Fadel", initials: "OF", role: "analyst" };
const ADMIN: CurrentUser = { id: "m-rana", name: "Rana Mansour", initials: "RM", role: "lead_admin" };
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

describe("data analyst overrides a team member (strictly higher)", () => {
  it("re-includes a team member's exclusion and audits the override", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);

    p.setCurrentUser(TEAM);
    p.setItemExcluded(CYCLE, aid, itemId, true, "ambiguous wording");
    expect(excluded(p, aid, itemId)).toBe(true);

    p.setCurrentUser(ANALYST);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "Re-included by analyst review");
    expect(excluded(p, aid, itemId)).toBe(false);

    const e = p.getAuditLog(CYCLE, "all", "").entries[0]!;
    expect(e.type).toBe("override");
    expect(e.isOverride).toBe(true);
    expect(e.actorName).toBe("Dana Aziz");
    expect(e.priorActor).toBe("Sami Haddad");
    expect(e.reason).toBe("Re-included by analyst review");
  });
});

describe("nobody overrides an equal or higher role", () => {
  it("data analyst CANNOT override an admin's exclusion", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ADMIN);
    p.setItemExcluded(CYCLE, aid, itemId, true, "admin exclusion");
    const before = auditLen(p);

    p.setCurrentUser(ANALYST);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "analyst trying to reverse an admin");
    expect(excluded(p, aid, itemId)).toBe(true); // unchanged
    expect(auditLen(p)).toBe(before); // nothing audited
  });

  it("data analyst CANNOT override another data analyst's exclusion", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ANALYST);
    p.setItemExcluded(CYCLE, aid, itemId, true, "analyst exclusion");
    const before = auditLen(p);

    p.setCurrentUser(ANALYST_2);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "peer analyst trying to reverse");
    expect(excluded(p, aid, itemId)).toBe(true);
    expect(auditLen(p)).toBe(before);
  });

  it("admin CANNOT override another admin's exclusion", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ADMIN);
    p.setItemExcluded(CYCLE, aid, itemId, true, "admin exclusion");
    const before = auditLen(p);

    p.setCurrentUser(ADMIN_2);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "peer admin trying to reverse");
    expect(excluded(p, aid, itemId)).toBe(true);
    expect(auditLen(p)).toBe(before);
  });

  it("admin CAN override a data analyst's exclusion (strictly higher)", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ANALYST);
    p.setItemExcluded(CYCLE, aid, itemId, true, "analyst exclusion");

    p.setCurrentUser(ADMIN);
    p.overrideItemExclusion(CYCLE, aid, itemId, false, "Admin re-included after appeal");
    expect(excluded(p, aid, itemId)).toBe(false);
    expect(p.getAuditLog(CYCLE, "all", "").entries[0]!.type).toBe("override");
  });
});

describe("mark-adjustment overrides follow the same strictly-higher rule", () => {
  function pickCell(p: InMemoryDataProvider) {
    const comp = p.getComposition(CYCLE)!;
    return comp.students
      .flatMap((s) => s.subjects.map((sj) => ({ pid: s.participantId, aid: sj.assessmentId, total: sj.total, max: sj.max })))
      .find((t) => t.total >= 8 && t.total <= t.max - 6)!;
  }

  it("analyst reverts a team member's adjustment; analyst cannot revert an admin's", () => {
    // Analyst over team member — allowed.
    const p1 = new InMemoryDataProvider();
    const c1 = pickCell(p1);
    p1.setCurrentUser(TEAM);
    p1.adjustStudentMark(CYCLE, c1.pid, c1.aid, c1.total + 2, "team member remark");
    p1.setCurrentUser(ANALYST);
    p1.overrideMarkAdjustment(CYCLE, c1.pid, c1.aid, null, "Analyst reverted: appeal not upheld");
    const base = JSON.stringify(new InMemoryDataProvider().getGrades(CYCLE)!.rows);
    expect(JSON.stringify(p1.getGrades(CYCLE)!.rows)).toBe(base);
    expect(p1.getAuditLog(CYCLE, "all", "").entries[0]!.type).toBe("override");

    // Analyst over admin — rejected.
    const p2 = new InMemoryDataProvider();
    const c2 = pickCell(p2);
    p2.setCurrentUser(ADMIN);
    p2.adjustStudentMark(CYCLE, c2.pid, c2.aid, c2.total + 2, "admin remark");
    const moved = JSON.stringify(p2.getGrades(CYCLE)!.rows);
    const before = auditLen(p2);
    p2.setCurrentUser(ANALYST);
    p2.overrideMarkAdjustment(CYCLE, c2.pid, c2.aid, null, "analyst trying to reverse an admin");
    expect(JSON.stringify(p2.getGrades(CYCLE)!.rows)).toBe(moved); // unchanged
    expect(auditLen(p2)).toBe(before); // nothing audited
  });
});

describe("Audit & overrides view — per-decision canOverride + setter role", () => {
  it("exposes a per-row canOverride that honours the strictly-higher rule", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);

    // A team member excludes the item.
    p.setCurrentUser(TEAM);
    p.setItemExcluded(CYCLE, aid, itemId, true, "team member exclusion");

    // Viewed AS an analyst: the row is overridable (analyst > team member), the
    // setter's tier is labelled, and the user has override rights overall.
    p.setCurrentUser(ANALYST);
    let view = p.getOverrideView(CYCLE);
    expect(view.canOverride).toBe(true);
    let row = view.decisions.find((d) => d.itemId === itemId)!;
    expect(row.canOverride).toBe(true);
    expect(row.decidedByRole).toBe("G12 team member");

    // A DIFFERENT decision set by an admin is NOT overridable by the analyst.
    const second = (() => {
      for (const a of p.getGrades(CYCLE)!.assessments) {
        const items = p.getReview(CYCLE, a.id)!.items;
        const it = items.find((i) => i.id !== itemId);
        if (it) return { aid: a.id, itemId: it.id };
      }
      throw new Error("need a second item");
    })();
    p.setCurrentUser(ADMIN);
    p.setItemExcluded(CYCLE, second.aid, second.itemId, true, "admin exclusion");

    p.setCurrentUser(ANALYST);
    view = p.getOverrideView(CYCLE);
    const adminRow = view.decisions.find((d) => d.itemId === second.itemId)!;
    expect(adminRow.decidedByRole).toBe("Admin");
    expect(adminRow.canOverride).toBe(false); // analyst can't override an admin
    // The team member's row remains overridable in the same view.
    row = view.decisions.find((d) => d.itemId === itemId)!;
    expect(row.canOverride).toBe(true);
  });

  it("a team member has no override rights at all", () => {
    const p = new InMemoryDataProvider();
    const { aid, itemId } = pickItem(p);
    p.setCurrentUser(ANALYST);
    p.setItemExcluded(CYCLE, aid, itemId, true, "analyst exclusion");
    p.setCurrentUser(TEAM);
    const view = p.getOverrideView(CYCLE);
    expect(view.canOverride).toBe(false);
    expect(view.decisions.every((d) => d.canOverride === false)).toBe(true);
  });
});
