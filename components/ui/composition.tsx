/**
 * Shared score-composition renderers — the transparent "MCQ + Essay + Alterations
 * → total" breakdown the team asked for. Both the Grades screen (overall, summed
 * across a student's subjects) and the dedicated Score screen (the same overall
 * line, plus a per-subject variant) render the SAME composition from the already
 * computed `participant_scores` fields (mcq / essay / alterations / total / max /
 * pct). Pure presentation — no scoring is recomputed here.
 */
import { H } from "@/lib/ui/tokens";
import type { StudentComposition, SubjectComposition } from "@/lib/data/types";

/** Compact number: integers stay whole; fractional scores show one decimal. */
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * One composition line: MCQ + Essay ± Alterations → total/max (optionally · pct%).
 * The single shared renderer behind both the overall and per-subject variants, so
 * the wording/format never drifts between Grades and Score.
 */
function CompositionLine({
  mcq,
  essay,
  alt,
  total,
  max,
  pct,
}: {
  mcq: number;
  essay: number;
  alt: number;
  total: number;
  max: number;
  pct?: number;
}) {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const a = r1(alt);
  return (
    <div
      className="hf-mono"
      style={{ fontSize: 10, color: H.ink3, display: "flex", gap: 6, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}
    >
      <span>MCQ {r1(mcq)}</span>
      <span>+ Essay {r1(essay)}</span>
      <span style={{ color: a ? H.pink : H.ink3 }}>{a >= 0 ? "+" : "−"} Alt {Math.abs(a)}</span>
      <span style={{ color: H.ink2 }}>
        → {fmtNum(total)}/{fmtNum(max)}
        {pct !== undefined ? ` · ${pct.toFixed(1)}%` : ""}
      </span>
    </div>
  );
}

/**
 * Overall composition for one student — MCQ + Essay + Alterations → total/max,
 * summed over the student's subjects. Shown with the Overall score on both Grades
 * and Score so the team can see how the total is built.
 */
export function InlineComposition({ cs }: { cs?: StudentComposition }) {
  if (!cs) return null;
  const mcq = cs.subjects.reduce((t, s) => t + s.mcq, 0);
  const essay = cs.subjects.reduce((t, s) => t + s.essay, 0);
  const alt = cs.subjects.reduce((t, s) => t + s.alterations, 0);
  return <CompositionLine mcq={mcq} essay={essay} alt={alt} total={cs.overall.total} max={cs.overall.max} />;
}

/**
 * Per-subject computed score for the Score screen: the prominent raw/max · % the
 * engine produced, with the MCQ + Essay + Alterations composition beneath it
 * (e.g. "MCQ 7 + Essay 0 + Alt 0 → 7/105 · 6.7%").
 */
export function SubjectScoreCell({ s }: { s: SubjectComposition }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <span
        className="hf-mono"
        style={{ fontSize: 11.5, color: H.ink, fontWeight: 600, whiteSpace: "nowrap" }}
        title="computed score · raw / max · percentage"
      >
        {fmtNum(s.total)} / {fmtNum(s.max)} · {s.pct.toFixed(1)}%
      </span>
      <CompositionLine mcq={s.mcq} essay={s.essay} alt={s.alterations} total={s.total} max={s.max} />
    </div>
  );
}
