/**
 * Build the canonical model by joining the three Questionmark exports on
 * `ResultId`. Faithful intake only — trusts QM's totals, keeps every question,
 * retains all participant data, excludes surveys, normalises subject names, runs
 * the reconciliation integrity guard, and tags the sitting.
 */

import { repairText } from "../repair";
import { isSurveyAssessment, stripHtml } from "../normalize";
import type { CsvTable } from "./csv";
import { detectThreeExports, type NamedInput } from "./detect";
import type {
  CanonicalModel,
  IntegrityReport,
  QmItem,
  QmParticipant,
  QmResult,
  QmTopicRollup,
  ReconcileIssue,
  Sitting,
} from "./model";

const RTL_SCRIPT = /[؀-ۿ]/;

/** Tolerance for the reconciliation check (QM percentages are exact integers/halves). */
const RECONCILE_EPS = 0.01;

function num(value: string | undefined, fallback: number | null): number | null {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function text(value: string | undefined): string | null {
  if (value === undefined) return null;
  const t = repairText(value).trim();
  if (t === "" || t === "<Not defined>" || t === "<Unknown>") return null;
  return t;
}

/**
 * Normalise a raw `AssessmentName` to its canonical subject name: repair
 * encoding, collapse whitespace, and merge the "Applicable Maths" variant into
 * "Applicable Math" (per the data-map decision — one subject, not two).
 */
export function normalizeSubjectName(raw: string): string {
  const repaired = repairText(raw).replace(/\s+/g, " ").trim();
  return repaired.replace(/Applicable\s+Maths\b/gi, "Applicable Math");
}

const MONTH_TO_PERIOD: Record<string, "february" | "may"> = {
  JAN: "february",
  FEB: "february",
  MAR: "february",
  APR: "february",
  MAY: "may",
  JUN: "may",
  JUL: "may",
  AUG: "may",
  SEP: "may",
  OCT: "may",
  NOV: "may",
  DEC: "may",
};

const MONTH_LABEL: Record<string, string> = {
  JAN: "January", FEB: "February", MAR: "March", APR: "April",
  MAY: "May", JUN: "June", JUL: "July", AUG: "August",
  SEP: "September", OCT: "October", NOV: "November", DEC: "December",
};

/**
 * Parse the sitting from a `ResultGroupName` like "Math Shatila 1 MAY2026".
 * Jan–Apr map to the February sitting, the rest to May (mirrors migration 0005).
 */
export function parseSitting(groupName: string | null | undefined): Sitting | null {
  if (!groupName) return null;
  const m = groupName.toUpperCase().match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*((?:19|20)\d{2})/);
  if (!m) return null;
  const mon = m[1]!;
  const year = Number(m[2]!);
  return {
    code: `${mon}${year}`,
    period: MONTH_TO_PERIOD[mon]!,
    year,
    label: `${MONTH_LABEL[mon]} ${year}`,
  };
}

interface RowsByResult {
  items: Map<string, Record<string, string>[]>;
  topics: Map<string, Record<string, string>[]>;
}

function groupByResultId(table: CsvTable): Map<string, Record<string, string>[]> {
  const map = new Map<string, Record<string, string>[]>();
  for (const row of table.rows) {
    const rid = (row["ResultId"] ?? "").trim();
    if (!rid) continue;
    const bucket = map.get(rid);
    if (bucket) bucket.push(row);
    else map.set(rid, [row]);
  }
  return map;
}

/** Build the canonical model from three already-parsed tables. */
export function buildCanonicalModelFromTables(
  items: CsvTable,
  assessments: CsvTable,
  topics: CsvTable,
): CanonicalModel {
  const byResult: RowsByResult = {
    items: groupByResultId(items),
    topics: groupByResultId(topics),
  };

  const results: QmResult[] = [];
  const excludedSurveys = new Set<string>();
  let surveyResults = 0;
  const sittingTally = new Map<string, { sitting: Sitting; count: number }>();

  // ── 1. One QmResult per graded assessment row, joined to its items + topics ──
  for (const row of assessments.rows) {
    const rawName = repairText(row["AssessmentName"] ?? "").trim();
    if (isSurveyAssessment(rawName)) {
      excludedSurveys.add(rawName);
      surveyResults += 1;
      continue;
    }
    const resultId = (row["ResultId"] ?? "").trim();
    if (!resultId) continue;

    const subject = normalizeSubjectName(rawName);
    const groupName = text(row["ResultGroupName"]);
    const sitting = parseSitting(groupName);
    if (sitting) {
      const t = sittingTally.get(sitting.code) ?? { sitting, count: 0 };
      t.count += 1;
      sittingTally.set(sitting.code, t);
    }

    const itemRows = byResult.items.get(resultId) ?? [];
    const responses = itemRows.map((it) => ({
      questionId: (it["QuestionId"] ?? "").trim(),
      answerGiven: text(it["AnswerGiven"]),
      answerScore: num(it["AnswerScore"], 0)!,
      responseTime: num(it["AnswerResponseTimeSeconds"], null),
      questionType: text(it["QuestionType"]) ?? "",
      status: text(it["QuestionStatus"]),
    }));

    const topicRows = byResult.topics.get(resultId) ?? [];
    const topicRollups: QmTopicRollup[] = topicRows.map((tp) => ({
      topicId: text(tp["TopicId"]),
      name: repairText(tp["TopicName"] ?? "").trim(),
      path: text(tp["TopicPath"]),
      score: num(tp["TopicScore"], 0)!,
      maximumScore: num(tp["TopicMaximumScore"], 0)!,
      percentageScore: num(tp["TopicPercentageScore"], null),
      questionCount: num(tp["TopicQuestionCount"], 0)!,
    }));

    results.push({
      resultId,
      subject,
      rawSubjectName: rawName,
      participantEmail: (text(row["ResultParticipantName"]) ?? "").toLowerCase(),
      groupName,
      sitting,
      status: text(row["ResultStatus"]),
      attemptNumber: num(row["ResultAssessmentAttemptNumber"], null),
      totalScore: num(row["ResultTotalScore"], 0)!,
      maximumScore: num(row["ResultMaximumScore"], 0)!,
      percentageScore: num(row["ResultPercentageScore"], null),
      scoreband: text(row["ResultScorebandName"]),
      responses,
      topics: topicRollups,
    });
  }

  // ── 2. Participants, keyed by email, retaining every personal field ──────────
  const participantMap = new Map<string, QmParticipant>();
  for (const row of assessments.rows) {
    const rawName = repairText(row["AssessmentName"] ?? "").trim();
    if (isSurveyAssessment(rawName)) continue;
    const email = (text(row["ResultParticipantName"]) ?? "").toLowerCase();
    if (!email) continue;
    let p = participantMap.get(email);
    if (!p) {
      const first = text(row["ResultParticipantFirstName"]);
      const last = text(row["ResultParticipantLastName"]);
      p = {
        email,
        firstName: first,
        lastName: last,
        fullName: [first, last].filter(Boolean).join(" ") || null,
        dob: text(row["ResultSpecialField4"]),
        gender: text(row["ResultSpecialField5"]),
        details: text(row["ResultParticipantDetails"]),
        groupNames: [],
      };
      participantMap.set(email, p);
    }
    const group = text(row["ResultGroupName"]);
    if (group && !p.groupNames.includes(group)) p.groupNames.push(group);
  }

  // ── 3. Distinct items per subject (type / max / status / topic) ──────────────
  const itemMap = new Map<string, QmItem>(); // `${subject}|${questionId}`
  for (const result of results) {
    const itemRows = byResult.items.get(result.resultId) ?? [];
    for (const it of itemRows) {
      const questionId = (it["QuestionId"] ?? "").trim();
      if (!questionId) continue;
      const key = `${result.subject}|${questionId}`;
      if (itemMap.has(key)) continue;
      itemMap.set(key, {
        subject: result.subject,
        questionId,
        questionType: text(it["QuestionType"]) ?? "",
        maxScore: num(it["QuestionMaximumScore"], 0)!,
        status: text(it["QuestionStatus"]),
        topicName: text(it["QuestionTopicName"]),
        topicPath: text(it["QuestionTopicPath"]),
        wording: stripHtml(it["QuestionWording"]),
      });
    }
  }
  const allItems = [...itemMap.values()];

  // ── 4. Subjects (canonical), first-appearance order ──────────────────────────
  const subjectOrder: string[] = [];
  const rawNamesBySubject = new Map<string, Set<string>>();
  const resultsBySubject = new Map<string, QmResult[]>();
  for (const r of results) {
    if (!resultsBySubject.has(r.subject)) {
      resultsBySubject.set(r.subject, []);
      subjectOrder.push(r.subject);
    }
    resultsBySubject.get(r.subject)!.push(r);
    let raws = rawNamesBySubject.get(r.subject);
    if (!raws) {
      raws = new Set();
      rawNamesBySubject.set(r.subject, raws);
    }
    raws.add(r.rawSubjectName);
  }

  const subjects = subjectOrder.map((name) => {
    const subjItems = allItems.filter((it) => it.subject === name);
    const subjResults = resultsBySubject.get(name)!;
    // Modal ResultMaximumScore (the canonical denominator QM reports).
    const maxFreq = new Map<number, number>();
    for (const r of subjResults) maxFreq.set(r.maximumScore, (maxFreq.get(r.maximumScore) ?? 0) + 1);
    let qmMax = 0;
    let best = -1;
    for (const [mx, f] of maxFreq) if (f > best) { best = f; qmMax = mx; }
    return {
      name,
      rawNames: [...rawNamesBySubject.get(name)!],
      rtl: RTL_SCRIPT.test(name),
      itemCount: subjItems.length,
      qmMaximumScore: qmMax,
      resultCount: subjResults.length,
      betaItemCount: subjItems.filter((it) => (it.status ?? "").toLowerCase() === "beta").length,
    };
  });

  // ── 5. Integrity guard: QM totals must equal the item-level sums ─────────────
  const issues: ReconcileIssue[] = [];
  for (const r of results) {
    const itemRows = byResult.items.get(r.resultId) ?? [];
    const sumItemMax = itemRows.reduce((s, it) => s + (num(it["QuestionMaximumScore"], 0)!), 0);
    const sumItemScore = itemRows.reduce((s, it) => s + (num(it["AnswerScore"], 0)!), 0);
    const maxOk = Math.abs(sumItemMax - r.maximumScore) <= RECONCILE_EPS;
    const totalOk = Math.abs(sumItemScore - r.totalScore) <= RECONCILE_EPS;
    if (!maxOk || !totalOk) {
      issues.push({
        resultId: r.resultId,
        subject: r.subject,
        participantEmail: r.participantEmail,
        expectedMax: r.maximumScore,
        sumItemMax,
        expectedTotal: r.totalScore,
        sumItemScore,
        maxOk,
        totalOk,
      });
    }
  }
  const integrity: IntegrityReport = {
    resultsChecked: results.length,
    reconciled: results.length - issues.length,
    issues,
    ok: issues.length === 0,
  };

  // ── 6. Dominant sitting tag for the export ───────────────────────────────────
  let sitting: Sitting | null = null;
  let bestCount = -1;
  for (const { sitting: s, count } of sittingTally.values()) {
    if (count > bestCount) { bestCount = count; sitting = s; }
  }

  return {
    sitting,
    subjects,
    participants: [...participantMap.values()],
    items: allItems,
    results,
    integrity,
    excludedSurveys: [...excludedSurveys],
    stats: {
      assessmentRows: assessments.rows.length,
      itemRows: items.rows.length,
      topicRows: topics.rows.length,
      gradedResults: results.length,
      surveyResults,
    },
  };
}

/**
 * Detect + parse a multi-file upload (the three QM CSVs in any order) and build
 * the canonical model. Throws a clear `DetectionError` if the three required
 * files aren't all present.
 */
export function buildCanonicalModel(files: readonly NamedInput[]): CanonicalModel {
  const { items, assessments, topics } = detectThreeExports(files);
  return buildCanonicalModelFromTables(items, assessments, topics);
}
