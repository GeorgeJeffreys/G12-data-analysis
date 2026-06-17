/**
 * Pure pipeline stage → route + "do next" copy. Shared by the data provider
 * (which resolves a cycle's current step) and the Pipeline stepper (which links
 * each stage to its screen) so the two never disagree about where a stage lives.
 *
 * The 10-stage order (see PIPELINE): Upload → Raw data → Clean → Raw scores →
 * Review → Adjustments → Score → Boundaries → Grades → Export. `stageIndex` is
 * the first INCOMPLETE stage for a cycle, so routing to it lands the user on the
 * earliest action whose prerequisites already exist — never deep in the pipeline
 * on a screen (Review/Boundaries/…) whose data hasn't been produced yet.
 */

/** Map a pipeline stage index to its route. Score and Boundaries are distinct
 *  screens: Score shows the computed post-adjustment scores, Boundaries sets the
 *  cut-points. */
export function stageRoute(cycleId: string, index: number): string {
  const base = `/cycles/${cycleId}`;
  switch (index) {
    case 0: // Upload
      return `${base}/import`;
    case 1: // Raw data
      return `${base}/raw-data`;
    case 2: // Clean
      return `${base}/clean`;
    case 3: // Raw scores
      return `${base}/raw-scores`;
    case 4: // Review
      return `${base}/review`;
    case 5: // Adjustments
      return `${base}/adjustments`;
    case 6: // Score
      return `${base}/score`;
    case 7: // Boundaries
      return `${base}/boundaries`;
    case 8: // Grades
      return `${base}/grades`;
    case 9: // Export
      return `${base}/documents`;
    default:
      return base;
  }
}

/** Title / body / CTA for the cycle's current step, keyed by stage index. The
 *  copy describes the *action to take next* at that stage. */
const STEP_COPY: { title: string; body: string; cta: string }[] = [
  { title: "Upload exam data", body: "Start by uploading the raw exam export — we detect each subject and split it for you.", cta: "Go to upload" },
  { title: "Review raw data", body: "The export is in. Check the raw response matrix for each subject before cleaning.", cta: "Go to raw data" },
  { title: "Clean the data", body: "Resolve any validation issues so the dataset is ready to score.", cta: "Go to cleaning" },
  { title: "Check raw scores", body: "Review the naïve (pre-adjustment) scores produced from the cleaned data.", cta: "Go to raw scores" },
  { title: "Review item quality", body: "Assessments are validated and waiting for quality review before scoring.", cta: "Go to item review" },
  { title: "Apply adjustments", body: "Triage incidents into mark alterations before final scoring.", cta: "Go to adjustments" },
  { title: "Review computed scores", body: "Adjustments are applied — review the final post-adjustment computed scores per student.", cta: "Go to scores" },
  { title: "Set boundaries", body: "Scores are confirmed — set grade boundaries for each subject to derive grades.", cta: "Go to boundaries" },
  { title: "Confirm grades", body: "Boundaries are set — review and confirm the resulting grades.", cta: "Go to grades" },
  { title: "Generate documents", body: "Grades are signed off. Generate certificates and performance reports for every student.", cta: "Generate documents" },
];

/** The "do next" action for a cycle sitting at `stageIndex` (its first
 *  incomplete stage). Routes to the matching screen with stage-appropriate copy. */
export function doNextForStage(cycleId: string, stageIndex: number): { title: string; body: string; href: string; cta: string } {
  const i = Math.max(0, Math.min(stageIndex, STEP_COPY.length - 1));
  const copy = STEP_COPY[i]!;
  return { ...copy, href: stageRoute(cycleId, i) };
}
