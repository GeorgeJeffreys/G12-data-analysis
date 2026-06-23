"use client";

/**
 * Screen 07 — Score. The dedicated screen for the final POST-ADJUSTMENT computed
 * scores, one row per participant, BEFORE any award boundaries are set. Distinct
 * from "Raw scores" (step 4, pre-adjustment) and from "Boundaries" (step 8, which
 * sets cut-points). Read-only: it displays the numbers the engine already
 * produced in `participant_scores` (via getComposition) — there is no cut-point UI
 * and nothing here changes a score. Award levels live on Grades, which is after
 * boundaries.
 *
 * Layout mirrors the Grades participant table for consistency: one all-subjects
 * table (not per-subject tabs), an identity column, a column per subject and an
 * Overall column. Each cell shows the computed score as raw/max and %, with the
 * transparent MCQ + Essay + Alterations composition beneath it — the same
 * composition logic the Grades screen renders, reused, not recomputed.
 */
import { useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { CycleShell, AlertStack } from "@/components/shell/CycleShell";
import { useProvisionalNotice } from "@/components/shell/ProvisionalBanner";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { useTableZoom, ZoomControl } from "@/lib/ui/tableZoom";
import { SubjectScoreCell } from "@/components/ui/composition";
import type { StudentComposition } from "@/lib/data/types";
import Link from "next/link";

export default function ScorePage({ params }: { params: { cycleId: string } }) {
  const cycleId = params.cycleId;
  const comp = useProviderData((p) => p.getComposition(cycleId), [cycleId]);
  // Grades is only used for the human Student ID (the secondary identity line);
  // every score on this screen comes from the composition (participant_scores).
  const grades = useProviderData((p) => p.getGrades(cycleId), [cycleId]);
  const cycleName = useProviderData((p) => p.getCycle(cycleId)?.name, [cycleId]) ?? "Sitting";
  const provisional = useProvisionalNotice(cycleId);
  const { zoom, setZoom, scrollRef, zoomWrapStyle } = useTableZoom();

  if (!comp || comp.students.length === 0) {
    return (
      <CycleShell
        cycleId={cycleId}
        cycleName={cycleName}
        page="Score"
        stageIndex={7}
        // Keep the forward CTA present but disabled in the empty state — the step
        // should never look broken/incomplete, but you can't advance to cut scores
        // with nothing to cut. (Enabled once `participant_scores` exist, below.)
        primary={
          <Button variant="pri" disabled title="Compute scores first">
            Continue
            <Icon name="arrow" color="#fff" />
          </Button>
        }
      >
        <div style={{ padding: 32 }} className="hf-sub">No computed scores for this sitting yet.</div>
      </CycleShell>
    );
  }

  // studentId (human) by internal participant id — grades.row.id === participantId.
  const studentIdById = new Map((grades?.rows ?? []).map((r) => [r.id, r.studentId]));

  return (
    <CycleShell
      cycleId={cycleId}
      cycleName={cycleName}
      page="Score"
      stageIndex={7}
      primary={
        <Link href={`/cycles/${cycleId}/boundaries`}>
          <Button variant="pri" title="Continue to cut scores">
            Continue
            <Icon name="arrow" color="#fff" />
          </Button>
        </Link>
      }
      alerts={<AlertStack notices={provisional ? [provisional] : []} />}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "16px 32px 18px", gap: 12, flex: 1, minHeight: 0 }}>
        {/* slim header strip — title + plain-language note + zoom, kept small so the
            table (the point of the screen) gets the vertical space */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <span className="hf-h2" style={{ fontSize: 16 }}>Computed scores</span>
          <span className="hf-sub" style={{ fontSize: 12, maxWidth: 660 }}>
            Final post-adjustment scores per student — the numbers boundaries are set against. Each subject cell shows
            raw/max and %; hover for the MCQ + Essay + Alterations breakdown. The last two columns are display-only
            signals (D3 questions attempted, technical incidents). There is no sitting “Overall” here — the final
            Overall is the best of February + May at the year level.
          </span>
          <div style={{ flex: 1, minWidth: 12 }} />
          <ZoomControl zoom={zoom} onZoom={setZoom} />
        </div>

        {/* scores table — same all-subjects participant-table layout as Grades */}
        <div ref={scrollRef} className="hf-card" style={{ overflow: "auto", flex: 1, minWidth: 0 }}>
          <div style={zoomWrapStyle}>
            {/* Spreadsheet-style: fixed column widths, subtle gridlines (hf-grid),
                a sticky header row (hf-th) and a sticky participant column
                (hf-sticky-col). One compact figure per cell; hover reveals the
                MCQ + Essay + Alterations composition via the cell's title. */}
            <table className="hf-grid" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th className="hf-th hf-sticky-col" style={{ width: 200 }}>Participant</th>
                  {comp.subjects.map((s) => (
                    <th key={s.id} className="hf-th" style={{ textAlign: "right", width: 104 }}>{subjectHeader(s.shortName)}</th>
                  ))}
                  <th
                    className="hf-th"
                    style={{ textAlign: "right", width: 100 }}
                    title="Of all the top-difficulty (D3) questions across this student's exams, the share they attempted. Display only — does not change any score or grade."
                  >
                    D3 answered
                    <div style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: H.ink3, fontSize: 9 }}>% attempted</div>
                  </th>
                  <th
                    className="hf-th"
                    style={{ textAlign: "right", width: 92 }}
                    title="Number of this student's sittings flagged with a technical result status (e.g. Finished Abnormally, Time Limit Exceeded). Display only — does not change any score or grade."
                  >
                    Incidents
                    <div style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: H.ink3, fontSize: 9 }}>technical</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {comp.students.map((st) => {
                  const byAssessment = new Map(st.subjects.map((s) => [s.assessmentId, s]));
                  return (
                    <tr key={st.participantId} className="hf-hover">
                      <td className="hf-td hf-sticky-col">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={st.name}>{st.name}</div>
                          <div className="hf-mono" style={{ fontSize: 10.5, color: H.ink3, marginTop: 1 }} title="Student ID">
                            {studentIdById.get(st.participantId) ?? st.participantId}
                          </div>
                        </div>
                      </td>
                      {comp.subjects.map((sub) => {
                        const s = byAssessment.get(sub.id);
                        return (
                          <td key={sub.id} className="hf-td" style={{ textAlign: "right" }}>
                            {s ? <SubjectScoreCell s={s} /> : <span className="hf-sub hf-mono" title="No score for this subject">–</span>}
                          </td>
                        );
                      })}
                      <td className="hf-td" style={{ textAlign: "right" }}>
                        <D3AnsweredCell d3={st.signals.d3} />
                      </td>
                      <td className="hf-td" style={{ textAlign: "right" }}>
                        <IncidentsCell n={st.signals.incidents} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </CycleShell>
  );
}

/**
 * % of this student's top-difficulty (D3) questions attempted — a display-only
 * engagement signal (does not affect scoring). Shows "–" when the student had no
 * D3 items; the attempted/available counts are revealed on hover.
 */
function D3AnsweredCell({ d3 }: { d3: StudentComposition["signals"]["d3"] }) {
  if (d3.pct === null || d3.available === 0) {
    return <span className="hf-sub hf-mono" title="No top-difficulty (D3) questions in this student's exams">–</span>;
  }
  return (
    <span
      className="hf-mono"
      style={{ fontSize: 12, color: H.ink, fontWeight: 600, whiteSpace: "nowrap" }}
      title={`Attempted ${d3.attempted} of ${d3.available} top-difficulty (D3) questions`}
    >
      {Math.round(d3.pct)}%
    </span>
  );
}

/**
 * Count of this student's sittings flagged with a technical result status
 * (e.g. 'Finished Abnormally', 'Time Limit Exceeded'). Display-only; a non-zero
 * count is highlighted, zero is muted.
 */
function IncidentsCell({ n }: { n: number }) {
  return (
    <span
      className="hf-mono"
      style={{ fontSize: 12.5, fontWeight: n ? 700 : 400, color: n ? H.warn : H.ink3, whiteSpace: "nowrap" }}
      title={
        n
          ? `${n} sitting${n === 1 ? "" : "s"} flagged with a technical result status (e.g. Finished Abnormally, Time Limit Exceeded)`
          : "No technical incidents"
      }
    >
      {n}
    </span>
  );
}

/**
 * Clean subject-name column header — identical to the Grades table. Reads the
 * already-classified `shortName` (e.g. "Arabic 1st Lang"), never the raw
 * assessment name, so it never falls back to the "G12++ " data prefix.
 */
function subjectHeader(shortName: string): string {
  if (/applicable/i.test(shortName)) return "Applicable Math";
  if (/english/i.test(shortName)) return "English";
  if (/scientific/i.test(shortName)) return "Scientific";
  if (/arabic/i.test(shortName)) return "Arabic";
  if (/life/i.test(shortName)) return "Life";
  // Strip any "G12++ " data prefix before falling back to the raw label.
  return shortName.replace(/^\s*G12\+\+\s*/i, "").split(" ")[0] || shortName;
}
