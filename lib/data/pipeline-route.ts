/**
 * Pure pipeline stage → route + "do next" copy. Shared by the data provider
 * (which resolves a cycle's current step) and the Pipeline stepper (which links
 * each stage to its screen) so the two never disagree about where a stage lives.
 *
 * The 11-stage order (see PIPELINE): Upload → Clean → Raw scores →
 * Question review → Diagnostics → Essay marks → Technical adjustments → Score →
 * Cut scores → Grades → Export. `stageIndex` is the first INCOMPLETE stage for a
 * cycle, so routing to it lands the user on the earliest action whose
 * prerequisites already exist — never deep in the pipeline on a screen
 * (Review/Cut scores/…) whose data hasn't been produced yet.
 */

/** Map a pipeline stage index to its route. Raw data is now folded into Clean;
 *  Score and Cut scores are distinct screens: Score shows the computed
 *  post-adjustment scores, Cut scores (the /boundaries screen) sets the
 *  cut-points. */
export function stageRoute(cycleId: string, index: number): string {
  const base = `/cycles/${cycleId}`;
  switch (index) {
    case 0: // Upload
      return `${base}/import`;
    case 1: // Clean (raw data folded in)
      return `${base}/clean`;
    case 2: // Raw scores
      return `${base}/raw-scores`;
    case 3: // Question review
      return `${base}/review`;
    case 4: // Diagnostics
      return `${base}/diagnostics`;
    case 5: // Essay marks
      return `${base}/essays`;
    case 6: // Technical adjustments
      return `${base}/adjustments`;
    case 7: // Score
      return `${base}/score`;
    case 8: // Cut scores
      return `${base}/boundaries`;
    case 9: // Grades — final per-sitting step. Document/certificate generation is
            // NOT a per-sitting step: it issues from the cycle/overall best-of-two
            // award (app/years/[yearId]/overall/documents), not a single sitting.
      return `${base}/grades`;
    default:
      return base;
  }
}

/** Title / body / CTA for the cycle's current step, keyed by stage index. The
 *  copy describes the *action to take next* at that stage. */
const STEP_COPY: { title: string; body: string; cta: string }[] = [
  { title: "Upload exam data", body: "Start by uploading the raw exam export — we detect each subject and split it for you.", cta: "Go to upload" },
  { title: "Clean the data", body: "Review the raw response matrix and resolve any validation issues so the dataset is ready to score.", cta: "Go to cleaning" },
  { title: "Check raw scores", body: "Review the naïve (pre-adjustment) scores produced from the cleaned data.", cta: "Go to raw scores" },
  { title: "Review item quality", body: "Assessments are validated and waiting for quality review before scoring.", cta: "Go to item review" },
  { title: "Review diagnostics", body: "Check cohort-level diagnostics and reliability (Cronbach's alpha) before continuing — review only, never changes a grade.", cta: "Go to diagnostics" },
  { title: "Enter essay marks", body: "Load or enter the offline-marked essay scores for English & Arabic.", cta: "Go to essay marks" },
  { title: "Apply technical adjustments", body: "Triage incidents into mark alterations before final scoring.", cta: "Go to technical adjustments" },
  { title: "Review computed scores", body: "Adjustments are applied — review the final post-adjustment computed scores per student.", cta: "Go to scores" },
  { title: "Set cut scores", body: "Scores are confirmed — set cut scores for each subject to derive grades.", cta: "Go to cut scores" },
  { title: "Confirm grades", body: "Cut scores are set — review and confirm the resulting grades.", cta: "Go to grades" },
];

/** The "do next" action for a cycle sitting at `stageIndex` (its first
 *  incomplete stage). Routes to the matching screen with stage-appropriate copy. */
export function doNextForStage(cycleId: string, stageIndex: number): { title: string; body: string; href: string; cta: string } {
  const i = Math.max(0, Math.min(stageIndex, STEP_COPY.length - 1));
  const copy = STEP_COPY[i]!;
  return { ...copy, href: stageRoute(cycleId, i) };
}
