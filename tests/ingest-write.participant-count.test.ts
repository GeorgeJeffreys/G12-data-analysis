/**
 * Server ingest write path — per-subject participant count is preserved in the
 * PERSISTED payload (the "15 → 7" collapse regression guard).
 *
 * Coverage gap this closes: `participant-identity-collapse.test.ts` proves the
 * IN-MEMORY path (ingestThreeExports → buildLiveCycleData → InMemoryDataProvider)
 * keeps all 15 Applicable Math sitters. But the live app does NOT use that path to
 * persist — it builds a payload in `lib/server/ingest-write.ts` and hands it to the
 * `ingest_persist` SQL function. Nothing pinned that payload's per-subject distinct
 * participant count, so a regression in the persist builder (a dedupe on a lossy
 * key, a bad participant/item join) could silently reintroduce the collapse in the
 * DB while every in-memory test stayed green.
 *
 * This drives the REAL persist builder over the realistic-identity fixture (the
 * only fixture that reproduces the collision shape) and asserts, from the captured
 * `ingest_persist` payload alone, that each subject's distinct participant count in
 * the persisted responses matches the ground-truth roster — Applicable Math = 15,
 * never 9 or 7. Staff/test accounts are still present here: the payload is the raw
 * ingest; the cohort boundary (staff exclusion) is applied later at the engine /
 * hydrate stage. So these are the Upload-stage counts (15/12/12/9/11), matching the
 * detection oracle in participant-identity-collapse.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestThreeExports, type NamedInput } from "@/lib/ingest/qm";
import { makeRpcAdmin, type RpcCall, type IngestPayload } from "./helpers/mock-rpc-admin";

vi.mock("server-only", () => ({}));
const { ingestCleanResponses } = await import("@/lib/server/ingest-write");

const here = path.dirname(fileURLToPath(import.meta.url));
const qmDir = path.join(here, "fixtures", "qm");
const collideDir = path.join(here, "fixtures", "qm-collide");
const read = (name: string) => readFileSync(path.join(qmDir, `${name}.csv`));
// Realistic identities: only ResultParticipantName (email) is collision-free; every
// name/DOB field collides. Items + Topics are reused from the de-identified fixture.
const files = (): NamedInput[] => [
  { name: "Items.csv", data: read("Items") },
  { name: "Assessments.csv", data: readFileSync(path.join(collideDir, "Assessments.csv")) },
  { name: "Topics.csv", data: read("Topics") },
];

/** Distinct participant_id per subject, computed from the persisted payload only. */
function distinctParticipantsPerSubject(p: IngestPayload): Map<string, number> {
  const assessmentName = new Map(p.assessments.map((a) => [a.id as string, a.name as string]));
  const itemAssessment = new Map(p.items.map((it) => [it.id as string, it.assessment_id as string]));
  const bySubject = new Map<string, Set<string>>();
  for (const r of p.responses) {
    const subj = assessmentName.get(itemAssessment.get(r.item_id as string) ?? "");
    if (!subj) continue;
    (bySubject.get(subj) ?? bySubject.set(subj, new Set()).get(subj)!).add(r.participant_id as string);
  }
  return new Map([...bySubject].map(([s, set]) => [s, set.size]));
}

describe("ingestCleanResponses — per-subject participant count is preserved in the persisted payload", () => {
  it("Applicable Math persists 15 distinct participants (the collapse would show 7/9)", async () => {
    const { canonical, cleanedResponses } = ingestThreeExports(files());
    const calls: RpcCall[] = [];
    await ingestCleanResponses(makeRpcAdmin(calls) as never, "cycle-1", cleanedResponses, {
      createdBy: "user-1",
      canonical,
    });
    const payload = calls[0]!.args.p_payload;
    const counts = distinctParticipantsPerSubject(payload);
    const count = (re: RegExp) => counts.get([...counts.keys()].find((n) => re.test(n))!) ?? 0;

    // The bug signature: Applicable Math collapses below its true 15 sitters.
    expect(count(/Applicable Math$/)).toBe(15);
    // Upload-stage counts (staff/test still present; cohort boundary applied later):
    // 15/12/12/9/11 — the detection oracle from participant-identity-collapse.test.ts.
    expect(count(/English/)).toBe(12);
    expect(count(/Scientific/)).toBe(12);
    expect(count(/العربيّة/)).toBe(9);
    expect(count(/Life/)).toBe(11);

    // Every distinct participant row persisted is a distinct qm_participant_id (email):
    // no two sitters folded onto one identity — the per-subject invariant's root.
    const qmIds = payload.participants.map((p) => p.qm_participant_id as string);
    expect(new Set(qmIds).size).toBe(qmIds.length);
    // Item counts are already correct and must stay so (41 Applicable Math items).
    const mathAssessment = payload.assessments.find((a) => /Applicable Math$/.test(a.name as string))!;
    const mathItems = payload.items.filter((it) => it.assessment_id === mathAssessment.id);
    expect(mathItems.length).toBe(41);
  });

  it("re-ingesting the same data persists the SAME 15 (no drift to 7 on re-upload)", async () => {
    const { canonical, cleanedResponses } = ingestThreeExports(files());
    const run = async () => {
      const calls: RpcCall[] = [];
      await ingestCleanResponses(makeRpcAdmin(calls) as never, "cycle-1", cleanedResponses, {
        createdBy: "user-1",
        canonical,
      });
      return distinctParticipantsPerSubject(calls[0]!.args.p_payload);
    };
    const first = await run();
    const second = await run();
    const mathKey = (m: Map<string, number>) => m.get([...m.keys()].find((n) => /Applicable Math$/.test(n))!);
    expect(mathKey(first)).toBe(15);
    expect(mathKey(second)).toBe(15);
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort());
  });
});
