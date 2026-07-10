/**
 * Matcher + reconciliation for the technical-incident export (0043). Covers EVERY
 * match bucket using the two real sample rows' shapes plus fabricated rows:
 *   - matched         — the May 2026 Arabic row (h.a@alsama.com → a sitting)
 *   - out_of_scope_cycle — the Feb 2026 row (wrong cycle wins over staff)
 *   - staff_excluded  — Lavinia, in the active cycle
 *   - unmatched_email — an email with no sitting in scope
 *   - unmatched_subject — a subject that maps to no code in the cycle
 *   - duplicate       — a Reference already staged (re-upsert)
 *   - multiple_incidents / q_list_missing flags
 * plus the pure helpers (classifySubjectName, isActiveCycle). Matching is
 * email-only; the STU-… id is never used; nothing is silently dropped.
 */
import { describe, it, expect } from "vitest";
import { parseExamIncidentRows, EXAM_INCIDENT_HEADERS } from "@/lib/incidents/exam-incident-parse";
import {
  matchExamIncidents,
  classifySubjectName,
  isActiveCycle,
  type ExamIncidentMatchContext,
} from "@/lib/incidents/exam-incident-match";

const HEADER = Object.values(EXAM_INCIDENT_HEADERS);
function row(patch: Partial<Record<keyof typeof EXAM_INCIDENT_HEADERS, string>>): string[] {
  const keys = Object.keys(EXAM_INCIDENT_HEADERS) as (keyof typeof EXAM_INCIDENT_HEADERS)[];
  return keys.map((k) => patch[k] ?? "");
}

const CTX: ExamIncidentMatchContext = {
  cycleId: "cyc-may",
  activeCycleName: "G12++ May 2026",
  subjects: [
    { code: "AFL", name: "Arabic as a First Language" },
    { code: "AM", name: "Applicable Math" },
  ],
  sittings: [
    { email: "h.a@alsama.com", subjectCode: "AFL", qmResultId: "R-1001", name: "H A" },
    { email: "real.student@alsama.com", subjectCode: "AM", qmResultId: "R-2002", name: "Real Student" },
  ],
  staffEmails: ["lavinia.cavalet@alsamaproject.com"],
  existingReferences: [],
};

function match(rows: string[][], ctx = CTX, existing: string[] = []) {
  const parsed = parseExamIncidentRows([HEADER, ...rows]);
  return matchExamIncidents(parsed, { ...ctx, existingReferences: existing }, { batchId: "b1", fileName: "exam-incidents.csv" });
}

const statusOf = (rep: ReturnType<typeof match>, reference: string) =>
  rep.rows.find((r) => r.reference === reference)?.status;

describe("classifySubjectName / isActiveCycle helpers", () => {
  it("maps the sample subjects to codes; Life Skills → null", () => {
    expect(classifySubjectName("Arabic as a First Language")).toBe("AFL");
    expect(classifySubjectName("Applicable Math")).toBe("AM");
    expect(classifySubjectName("English as a Second Language")).toBe("ESL");
    expect(classifySubjectName("Life Success Skills")).toBeNull();
  });
  it("accepts the short export cycle label against the prefixed app cycle name", () => {
    expect(isActiveCycle("May 2026", "G12++ May 2026")).toBe(true);
    expect(isActiveCycle("February 2026", "G12++ May 2026")).toBe(false);
    expect(isActiveCycle("", "G12++ May 2026")).toBe(false);
  });
});

describe("exam-incident matcher — every bucket", () => {
  it("matched — the May 2026 Arabic row resolves to a sitting id", () => {
    const rep = match([row({ reference: "INC-1", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "H.A@Alsama.com" })]);
    const r = rep.rows[0]!;
    expect(r.status).toBe("matched");
    expect(r.matchedQmResultId).toBe("R-1001");
    expect(rep.records[0]!.matchStatus).toBe("matched");
    // staging never adjusts
    expect(rep.records[0]!.adjustmentType).toBeNull();
    expect(rep.records[0]!.adjustmentMagnitude).toBeNull();
  });

  it("out_of_scope_cycle — the Feb 2026 row (wins over staff)", () => {
    const rep = match([row({ reference: "INC-2", examCycle: "February 2026", subject: "Applicable Math", studentEmail: "lavinia.cavalet@alsamaproject.com" })]);
    expect(statusOf(rep, "INC-2")).toBe("out_of_scope_cycle");
  });

  it("staff_excluded — Lavinia in the active cycle", () => {
    const rep = match([row({ reference: "INC-3", examCycle: "May 2026", subject: "Applicable Math", studentEmail: "lavinia.cavalet@alsamaproject.com" })]);
    expect(statusOf(rep, "INC-3")).toBe("staff_excluded");
  });

  it("unmatched_email — a present email with no sitting in scope", () => {
    const rep = match([row({ reference: "INC-4", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "ghost@nowhere.com" })]);
    expect(statusOf(rep, "INC-4")).toBe("unmatched_email");
    expect(rep.records.find((r) => r.reference === "INC-4")!.matchedQmResultId).toBeNull();
  });

  it("unmatched_subject — a subject that maps to no code in the cycle", () => {
    const rep = match([row({ reference: "INC-5", examCycle: "May 2026", subject: "Life Success Skills", studentEmail: "h.a@alsama.com" })]);
    expect(statusOf(rep, "INC-5")).toBe("unmatched_subject");
  });

  it("matched requires the email's sitting to be IN the named subject (else unmatched_email)", () => {
    // h.a sat AFL, not AM — an AM incident for h.a is unmatched_email, never a cross-subject match.
    const rep = match([row({ reference: "INC-6", examCycle: "May 2026", subject: "Applicable Math", studentEmail: "h.a@alsama.com" })]);
    expect(statusOf(rep, "INC-6")).toBe("unmatched_email");
  });

  it("duplicate — a Reference already staged is reported as an update, still upserted", () => {
    const rep = match(
      [row({ reference: "INC-1", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "h.a@alsama.com" })],
      CTX,
      ["INC-1"], // already staged from a prior batch
    );
    expect(statusOf(rep, "INC-1")).toBe("duplicate");
    // the substantive bucket is preserved for the record + the report
    expect(rep.rows[0]!.matchStatus).toBe("matched");
    expect(rep.records[0]!.matchStatus).toBe("matched");
  });

  it("duplicate — the same Reference twice within one batch flags the repeat", () => {
    const rep = match([
      row({ reference: "INC-7", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "h.a@alsama.com" }),
      row({ reference: "INC-7", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "h.a@alsama.com" }),
    ]);
    expect(rep.counts.duplicate).toBe(1);
  });

  it("error — a keyless row is surfaced but never staged", () => {
    const rep = match([row({ reference: "", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "h.a@alsama.com" })]);
    expect(rep.counts.error).toBe(1);
    expect(rep.records).toHaveLength(0); // not persisted
  });

  it("multiple_incidents — >1 matched incident for one (email, subject)", () => {
    const rep = match([
      row({ reference: "INC-8", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "h.a@alsama.com" }),
      row({ reference: "INC-9", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "h.a@alsama.com" }),
    ]);
    expect(rep.counts.multiple_incidents).toBe(2);
    expect(rep.records.every((r) => r.flags.includes("multiple_incidents"))).toBe(true);
  });

  it("counts every bucket across a mixed batch and nothing is dropped", () => {
    const rep = match([
      row({ reference: "M-1", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "h.a@alsama.com" }),
      row({ reference: "M-2", examCycle: "February 2026", subject: "Applicable Math", studentEmail: "lavinia.cavalet@alsamaproject.com" }),
      row({ reference: "M-3", examCycle: "May 2026", subject: "Applicable Math", studentEmail: "lavinia.cavalet@alsamaproject.com" }),
      row({ reference: "M-4", examCycle: "May 2026", subject: "Arabic as a First Language", studentEmail: "ghost@nowhere.com" }),
      row({ reference: "M-5", examCycle: "May 2026", subject: "Life Success Skills", studentEmail: "h.a@alsama.com" }),
    ]);
    expect(rep.counts.total).toBe(5);
    expect(rep.counts.matched).toBe(1);
    expect(rep.counts.out_of_scope_cycle).toBe(1);
    expect(rep.counts.staff_excluded).toBe(1);
    expect(rep.counts.unmatched_email).toBe(1);
    expect(rep.counts.unmatched_subject).toBe(1);
    expect(rep.records).toHaveLength(5); // all staged, nothing dropped
  });
});
