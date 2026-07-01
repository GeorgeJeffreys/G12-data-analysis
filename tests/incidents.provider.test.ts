/**
 * Provider wiring for the Incident Adjustments config registry: admin-gated CRUD.
 * A Lead (admin) can add/edit/delete codes, set the caps and the mapping; a lower
 * role sees the config read-only (canEdit=false) and its mutations are no-ops.
 */
import { describe, it, expect } from "vitest";
import { InMemoryDataProvider } from "@/lib/data/in-memory-provider";
import type { CurrentUser } from "@/lib/data/types";

const VIEWER: CurrentUser = { id: "v1", name: "Vera", initials: "V", role: "viewer" };

describe("incident config — admin writes", () => {
  it("a Lead can add, edit and delete an incident code", () => {
    const p = new InMemoryDataProvider();
    const before = p.getIncidentConfig().codes.length;
    p.upsertIncidentCode({
      code: "EXTRA_TIME",
      label: "Extra time granted",
      matchTypes: ["extra time"],
      formula: { kind: "fixed", marks: 1 },
      perCodeCap: 2,
    });
    let cfg = p.getIncidentConfig();
    expect(cfg.codes.length).toBe(before + 1);
    const added = cfg.codes.find((c) => c.code === "EXTRA_TIME")!;
    expect(added.perCodeCap).toBe(2);

    p.upsertIncidentCode({ ...added, label: "Extra time (edited)" });
    expect(p.getIncidentConfig().codes.find((c) => c.id === added.id)!.label).toBe("Extra time (edited)");

    p.deleteIncidentCode(added.id);
    expect(p.getIncidentConfig().codes.find((c) => c.id === added.id)).toBeUndefined();
  });

  it("rejects a non-add-only code (defence in depth — no negative stored)", () => {
    const p = new InMemoryDataProvider();
    const before = p.getIncidentConfig().codes.length;
    p.upsertIncidentCode({
      code: "BAD",
      label: "Bad",
      matchTypes: ["x"],
      formula: { kind: "fixed", marks: -5 },
      perCodeCap: 2,
    });
    expect(p.getIncidentConfig().codes.length).toBe(before); // not added
  });

  it("sets the per-student global cap and the column mapping", () => {
    const p = new InMemoryDataProvider();
    p.setIncidentPerStudentCap(8);
    expect(p.getIncidentConfig().perStudentCap).toBe(8);
    p.setIncidentPerStudentCap(null);
    expect(p.getIncidentConfig().perStudentCap).toBeNull();

    p.setIncidentMapping({ studentId: "SID", studentName: "N", incidentType: "T", questionNumber: "Q", duration: "D" });
    expect(p.getIncidentConfig().mapping.studentId).toBe("SID");
  });
});

describe("incident config — lower roles are read-only", () => {
  it("canEdit is false and mutations are no-ops for a viewer", () => {
    const p = new InMemoryDataProvider();
    p.setCurrentUser(VIEWER);
    const cfg = p.getIncidentConfig();
    expect(cfg.canEdit).toBe(false);

    const before = cfg.codes.length;
    p.upsertIncidentCode({ code: "NOPE", label: "Nope", matchTypes: ["y"], formula: { kind: "fixed", marks: 1 }, perCodeCap: 1 });
    p.setIncidentPerStudentCap(999);
    p.setIncidentMapping({ studentId: "hacked", studentName: "", incidentType: "", questionNumber: "", duration: "" });

    const after = p.getIncidentConfig();
    expect(after.codes.length).toBe(before); // nothing added
    expect(after.perStudentCap).not.toBe(999);
    expect(after.mapping.studentId).not.toBe("hacked");
  });
});
