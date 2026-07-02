/**
 * Ingest participant ATTRIBUTION — the "all-dots rows / dropped sitter" bug (task 16).
 *
 * This is NOT the identity-MERGE bug (distinct people folding into one overwritten
 * row — covered by participant-identity-collapse.test.ts). It is a resolution /
 * ATTRIBUTION failure: participant identity was resolved TWICE, independently, over
 * two different row-sets —
 *   * the ROSTER pass, over the Assessments export (one row per result — the
 *     complete roster), and
 *   * the RESPONSE pass, over the Items export (only results that have item rows).
 * Whenever a login code was shared by a result present in the Assessments set but
 * NOT the Items set (e.g. a ghost / survey sitting with no MCQ items), the
 * collision safety-net folded that code in the roster pass but not the response
 * pass — so a REAL sitter's responses attached to a DIFFERENT id than their roster
 * row. In the app that surfaced as roster rows with no responses ("all-dots") and
 * real sitters dropped from the per-subject count.
 *
 * The de-identified `student1…student18` fixture masks this (unique emails, every
 * sitter has items). This fixture carries the real shape: ResultParticipantName is a
 * NON-UNIQUE initials login code, several sitters share one, and two ghost SURVEY
 * results share codes with real English sitters (Amal, Fatima) but have no MCQ items.
 *
 * The fix: resolve identity ONCE over the authoritative Assessments roster and CARRY
 * it into the response normaliser, so the roster and the cells can never disagree.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestThreeExports, resolveAssessmentIdentities, type NamedInput } from "@/lib/ingest/qm";
import { detectThreeExports } from "@/lib/ingest/qm";
import { toCombinedRows } from "@/lib/ingest/qm";
import { normalizeResponses } from "@/lib/ingest";
import { assertResponsesAttachToRoster } from "@/lib/ingest";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "fixtures", "qm-attribution");
const read = (n: string) => readFileSync(path.join(dir, `${n}.csv`));
const files = (): NamedInput[] => [
  { name: "Assessments.csv", data: read("Assessments") },
  { name: "Items.csv", data: read("Items") },
  { name: "Topics.csv", data: read("Topics") },
];

const EN = "G12++ English as a 2nd Language";
const MA = "G12++ Applicable Math";

function bySubject(recs: { assessmentName: string; qmParticipantId: string }[]) {
  const m = new Map<string, Set<string>>();
  for (const r of recs) (m.get(r.assessmentName) ?? m.set(r.assessmentName, new Set()).get(r.assessmentName)!).add(r.qmParticipantId);
  return m;
}

describe("ingest attribution — roster and responses resolve identity once (task 16)", () => {
  it("every real sitter's responses attach to their roster identity (no all-dots, none dropped)", () => {
    const { canonical, cleanedResponses } = ingestThreeExports(files());

    const norm = bySubject(cleanedResponses);
    const canon = new Map<string, Set<string>>();
    for (const r of canonical.results) (canon.get(r.subject) ?? canon.set(r.subject, new Set()).get(r.subject)!).add(r.participantEmail);

    // All 12 real English sitters + all 15 Math sitters carry responses (none dropped).
    expect(norm.get(EN)?.size).toBe(12);
    expect(norm.get(MA)?.size).toBe(15);
    // The roster additionally holds the 2 abandoned item-less duplicate sittings
    // (genuinely no MCQ responses) — they are the ONLY zero-response entries.
    expect(canon.get(EN)?.size).toBe(14);
    expect(canon.get(MA)?.size).toBe(15);

    // Every response's resolved participant id is one the roster resolved — i.e.
    // no response is attributed to an identity absent from the roster (no orphans).
    const rosterIds = new Set([...resolveAssessmentIdentities(detectThreeExports(files()).assessments).values()].map((r) => r.id));
    for (const r of cleanedResponses) expect(rosterIds.has(r.qmParticipantId)).toBe(true);

    // Amal (700001) and Fatima (700002) — real sitters who share a login code with an
    // item-less duplicate sitting — carry real responses under their ROSTER identity
    // (before the fix their responses resolved to a different id → all-dots roster row).
    for (const rid of ["700001", "700002"]) {
      const forResult = cleanedResponses.filter((r) => r.qmResultId === rid);
      expect(forResult.length).toBeGreaterThan(0);
      const rosterId = canonical.results.find((r) => r.resultId === rid)!.participantEmail;
      for (const r of forResult) expect(r.qmParticipantId).toBe(rosterId);
    }
  });

  it("the OLD two-pass resolution DID diverge; carrying the roster identity fixes it", () => {
    const { items, assessments } = detectThreeExports(files());
    const identityByResult = resolveAssessmentIdentities(assessments);
    const combined = toCombinedRows(items, assessments);

    // OLD behaviour: normalize re-resolves identity independently over the Items
    // rows (no roster map passed).
    const independent = normalizeResponses(combined).clean;
    // FIXED behaviour: carry the authoritative roster identity.
    const carried = normalizeResponses(combined, identityByResult).clean;

    const idFor = (recs: { qmResultId: string; qmParticipantId: string }[], rid: string) =>
      recs.find((r) => r.qmResultId === rid)?.qmParticipantId;

    // Amal (700001) shares code "A-A" with a ghost survey result present in the
    // Assessments roster but absent from Items. The independent pass resolves her to
    // the bare code; the roster pass folds it → the two disagree (the bug).
    const rosterAmal = identityByResult.get("700001")!.id;
    expect(idFor(independent, "700001")).not.toBe(rosterAmal); // divergence reproduced
    expect(idFor(carried, "700001")).toBe(rosterAmal); // fixed: carried == roster
  });

  it("the roster↔responses guard throws when a response is attributed off-roster", () => {
    const clean = [
      { assessmentName: EN, qmResultId: "R1", qmParticipantId: "roster-id", participantPseudonym: "P0001" },
      { assessmentName: EN, qmResultId: "R2", qmParticipantId: "orphan-id", participantPseudonym: "P0002" },
    ] as never[];
    expect(() => assertResponsesAttachToRoster(clean, new Set(["roster-id"]))).toThrow(/attribution failure/i);
    expect(() => assertResponsesAttachToRoster(clean, new Set(["roster-id", "orphan-id"]))).not.toThrow();
  });
});
