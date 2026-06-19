/**
 * Build the in-memory provider's live-cycle data from cleaned responses.
 *
 * This is the same transform `scripts/build-seed.mts` runs at build time, but
 * generalised so it works on ANY combined export uploaded at runtime (it never
 * drops a subject it doesn't recognise). It runs the REAL engine over the
 * response matrix to compute item statistics, then assembles the SeedAssessment /
 * SeedParticipant / diagnostics shapes the rest of the in-memory provider reads.
 *
 * It does not change how statistics are computed — it produces exactly the same
 * per-subject grouping + engine inputs the pipeline already consumes, so engine
 * parity is unaffected. It is the in-memory mirror of the Supabase ingest write
 * path (lib/server/ingest-write.ts): both take CleanResponse[] and make the
 * pipeline run on it.
 */

import { getEngine, type ItemMeta, type QualityRating, type ResponseRecord } from "@/lib/engine";
import { speededness, timingPerformance, groupBy, type DiagResponse } from "@/lib/diagnostics";
import type {
  SeedAssessment,
  SeedAssessmentDiagnostics,
  SeedDiagGroup,
  SeedItem,
  SeedParticipant,
  SeedPreview,
  SeedResponse,
} from "./seed-types";
import type { CleanResponse } from "@/lib/ingest/types";

const RATING_SCORE: Record<QualityRating, number> = { Good: 1, Review: 0.55, Flag: 0.12 };
/** Transparent 0–100 quality index: mean of the four per-stat rating scores. */
function qualityIndex(stat: {
  pRating: QualityRating;
  itRating: QualityRating;
  pbRating: QualityRating;
  discRating: QualityRating;
}): number {
  const avg =
    (RATING_SCORE[stat.pRating] + RATING_SCORE[stat.itRating] + RATING_SCORE[stat.pbRating] + RATING_SCORE[stat.discRating]) / 4;
  return Math.round(avg * 100);
}

const RTL_SCRIPT = /[؀-ۿ]/;
/** A compact display name for the subject chips (keep it short, ASCII-safe). */
function shortNameOf(name: string): string {
  if (/applicable math/i.test(name)) return "Applicable Math";
  if (/english/i.test(name)) return "English 2nd Lang";
  if (/scientific/i.test(name)) return "Scientific";
  if (/life/i.test(name)) return "Life Skills";
  if (RTL_SCRIPT.test(name) || /arabic/i.test(name)) return "Arabic 1st Lang";
  return name.length > 22 ? `${name.slice(0, 21)}…` : name;
}

export interface LiveCycleData {
  participants: SeedParticipant[];
  assessments: SeedAssessment[];
  diagnostics: SeedAssessmentDiagnostics[];
  preview: SeedPreview;
}

/**
 * Turn cleaned MCQ responses into the live-cycle seed data (participants,
 * per-subject assessments with engine-computed item stats, diagnostics, preview).
 * Subjects keep first-appearance order; the subject's raw assessmentName is used
 * as its stable id (so boundary scopes / exclusions key off it consistently).
 */
export function buildLiveCycleData(clean: readonly CleanResponse[]): LiveCycleData {
  const engine = getEngine();

  // Group cleaned responses by raw assessment name (first-appearance order).
  const byName = new Map<string, CleanResponse[]>();
  for (const r of clean) {
    const bucket = byName.get(r.assessmentName);
    if (bucket) bucket.push(r);
    else byName.set(r.assessmentName, [r]);
  }

  // Participants in stable, sorted pseudonym order (no PII leaves the pseudonym).
  const realIdByPseudonym = new Map<string, string>();
  for (const r of clean) {
    if (!realIdByPseudonym.has(r.participantPseudonym)) realIdByPseudonym.set(r.participantPseudonym, r.qmParticipantId);
  }
  const partOrder = [...realIdByPseudonym.keys()].sort();
  const participants: SeedParticipant[] = partOrder.map((id, i) => ({
    id,
    label: `Student ${String(i + 1).padStart(2, "0")}`,
    studentId: realIdByPseudonym.get(id) ?? id,
  }));

  const assessments: SeedAssessment[] = [];
  const diagnostics: SeedAssessmentDiagnostics[] = [];

  for (const [name, recs] of byName) {
    const assessmentId = name;

    // Distinct items (first occurrence) with metadata, keyed by qm question id.
    const itemMetaMap = new Map<string, ItemMeta>();
    for (const r of recs) {
      if (!itemMetaMap.has(r.qmQuestionId)) {
        itemMetaMap.set(r.qmQuestionId, {
          itemId: r.qmQuestionId,
          assessmentId,
          wording: r.wording,
          majorElement: r.majorElement,
          subElement: r.subElement,
          demandLevel: r.demandLevel ?? null,
          maxScore: r.maxScore,
        });
      }
    }
    const itemMetas = [...itemMetaMap.values()];

    const responses: ResponseRecord[] = recs.map((r) => ({
      participantId: r.participantPseudonym,
      itemId: r.qmQuestionId,
      assessmentId,
      score: r.answerScore,
    }));

    const stats = engine.computeItemStats({ responses, items: itemMetas });
    const statById = new Map(stats.map((s) => [s.itemId, s]));

    // Per-item presented/answered/avg response time from the cleaned rows.
    interface Agg { presented: number; answered: number; timeSum: number; timeCount: number }
    const agg = new Map<string, Agg>();
    for (const r of recs) {
      let a = agg.get(r.qmQuestionId);
      if (!a) { a = { presented: 0, answered: 0, timeSum: 0, timeCount: 0 }; agg.set(r.qmQuestionId, a); }
      a.presented += 1;
      if (r.answerGiven) a.answered += 1;
      if (r.responseTime !== null && Number.isFinite(r.responseTime)) {
        a.timeSum += r.responseTime;
        a.timeCount += 1;
      }
    }

    const items: SeedItem[] = itemMetas.map((m) => {
      const s = statById.get(m.itemId)!;
      const a = agg.get(m.itemId);
      return {
        id: m.itemId,
        wording: m.wording ?? null,
        major: m.majorElement ?? null,
        sub: m.subElement ?? null,
        demand: m.demandLevel ?? null,
        maxScore: m.maxScore ?? 1,
        participantsAnswered: a?.answered ?? s.n,
        participantsPresented: a?.presented ?? s.n,
        avgResponseTime: a && a.timeCount > 0 ? Math.round((a.timeSum / a.timeCount) * 10) / 10 : null,
        pValue: s.pValue,
        pRating: s.pRating,
        itemTotal: s.itemTotal,
        itRating: s.itRating,
        pointBiserial: s.pointBiserial,
        pbRating: s.pbRating,
        discrimination: s.discrimination,
        discRating: s.discRating,
        overallReview: s.overallReview,
        qualityIndex: qualityIndex(s),
      };
    });

    const seedResponses: SeedResponse[] = responses.map((r) => ({ p: r.participantId, i: r.itemId, s: r.score }));

    // Speededness & timing diagnostics over the RAW sitting (export order proxy).
    const itemOrder = new Map<string, number>();
    for (const r of recs) if (!itemOrder.has(r.qmQuestionId)) itemOrder.set(r.qmQuestionId, itemOrder.size);
    const diagRecs: DiagResponse[] = recs.map((r) => ({
      participantId: r.participantPseudonym,
      itemId: r.qmQuestionId,
      majorElement: r.majorElement,
      order: itemOrder.get(r.qmQuestionId)!,
      answered: !!r.answerGiven,
      correct: r.answerScore === 1,
      responseTime: r.responseTime,
    }));
    const diagGroups: SeedDiagGroup[] = [{ key: "Overall", speeded: speededness(diagRecs), timing: timingPerformance(diagRecs) }];
    for (const [el, sub] of groupBy(diagRecs, (r) => r.majorElement)) {
      diagGroups.push({ key: el, speeded: speededness(sub), timing: timingPerformance(sub) });
    }
    diagnostics.push({ assessmentId, assessmentName: name, groups: diagGroups });

    assessments.push({
      id: assessmentId,
      name,
      shortName: shortNameOf(name),
      rtl: RTL_SCRIPT.test(name) || /arabic/i.test(name),
      stageIndex: 1, // freshly ingested → next action is Clean
      items,
      responses: seedResponses,
    });
  }

  // Cleaned-data preview: first 5 participants × first few items of subject 1.
  const first = assessments[0];
  let preview: SeedPreview = { headers: [], rows: [] };
  if (first) {
    const previewItems = first.items.slice(0, 4).map((it) => it.id);
    const scoreLookup = new Map<string, number>();
    for (const r of first.responses) scoreLookup.set(`${r.p}:${r.i}`, r.s);
    const previewParticipants = participants.filter((p) => first.responses.some((r) => r.p === p.id)).slice(0, 5);
    preview = {
      headers: ["ID", "Q1", "Q2", "Q3", "Q4", "…"],
      rows: previewParticipants.map((p) => [
        p.label,
        ...previewItems.map((i) => {
          const v = scoreLookup.get(`${p.id}:${i}`);
          return v === undefined ? "—" : v;
        }),
        "…",
      ]),
    };
  }

  return { participants, assessments, diagnostics, preview };
}
