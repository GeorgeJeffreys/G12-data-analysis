/**
 * Hand-written, strict TypeScript types for the Supabase schema defined in
 * `supabase/migrations/0001_init.sql`. Kept in the shape the Supabase client
 * expects (`Database`) so queries are typed end to end. When the schema
 * changes, update this file alongside the migration (or regenerate with the
 * Supabase type generator and re-apply the `Database` wrapper).
 */

// --- Enums (mirror the Postgres enums) --------------------------------------
export type CycleStatus =
  | "draft"
  | "ingested"
  | "validated"
  | "in_review"
  | "scored"
  | "graded"
  | "locked";

export type AssessmentStatus = "pending" | "in_review" | "reviewed" | "scored";
export type ItemStatus = "active" | "excluded";
export type MemberRole = "lead_admin" | "reviewer" | "viewer";
export type QualityRating = "Good" | "Review" | "Flag";
export type DemandLevel = "D1" | "D2" | "D3";
export type SchemeMethod = "judgemental" | "fixed_pct";
// 0003
export type IncidentSource = "incident_log" | "complaint";
export type AlterationApply = "student" | "subject" | "none";
// 0005 — a year contains two sittings; each sitting is a full pipeline run.
export type SittingPeriod = "february" | "may";

// --- Reusable JSON shapes ----------------------------------------------------
export interface GradeBand {
  label: string;
  min: number;
  max: number;
}

// --- Table row shapes --------------------------------------------------------
// 0010 — test_centres are the top-level scoping dimension. A centre (e.g.
// "Shatila 1") owns its own exam_years; sittings + results inherit the centre
// through the exam_cycles.year_id → exam_years.test_centre_id chain.
export interface TestCentreRow {
  id: string;
  name: string;
  /** Short tag, e.g. "SHA1". */
  code: string;
  /** Route-safe, unique, e.g. "shatila-1". */
  slug: string;
  region: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// 0005 — exam_years group sittings. A year is "2026"; its sittings are the
// February and May exam_cycles (pipeline runs) plus a derived Overall view.
export interface ExamYearRow {
  id: string;
  name: string;
  region: string;
  /**
   * 0010 — the test centre this year belongs to. NOT NULL after the 0010
   * backfill (every existing year was assigned to the "Unassigned" placeholder).
   * Definer-only: set exclusively by create_exam_year / create_cycle_with_assessments.
   */
  test_centre_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ExamCycleRow {
  id: string;
  name: string;
  status: CycleStatus;
  region: string;
  /** 0005 — the year this sitting belongs to (NULL only for un-migrated rows). */
  year_id: string | null;
  /** 0005 — which sitting of the year this pipeline run is. */
  sitting: SittingPeriod | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  id: string;
  /** NULL means a workspace-level membership: the role applies to ALL cycles. */
  cycle_id: string | null;
  user_id: string;
  role: MemberRole;
  created_at: string;
}

export interface AssessmentRow {
  id: string;
  cycle_id: string;
  name: string;
  item_count: number;
  status: AssessmentStatus;
  created_at: string;
}

export interface ItemRow {
  id: string;
  cycle_id: string;
  assessment_id: string;
  qm_question_id: string;
  wording: string | null;
  major_element: string | null;
  sub_element: string | null;
  demand_level: DemandLevel | null;
  max_score: number;
  status: ItemStatus;
  created_at: string;
}

export interface ItemStatsRow {
  item_id: string;
  p_value: number | null;
  p_rating: QualityRating | null;
  item_total: number | null;
  it_rating: QualityRating | null;
  point_biserial: number | null;
  pb_rating: QualityRating | null;
  discrimination: number | null;
  disc_rating: QualityRating | null;
  overall_review: QualityRating | null;
  computed_at: string;
  engine_version: string;
}

export interface ParticipantRow {
  id: string;
  cycle_id: string;
  qm_participant_id: string;
  pseudonym_id: string;
  full_name: string | null;
  email: string | null;
  dob: string | null;
  gender: string | null;
  created_at: string;
}

export interface ResponseRow {
  id: string;
  cycle_id: string;
  participant_id: string;
  item_id: string;
  answer_given: string | null;
  answer_score: number;
  response_time: number | null;
  result_status: string | null;
  created_at: string;
}

export interface ItemReviewRow {
  id: string;
  item_id: string;
  reviewer_id: string;
  exclude: boolean;
  reason: string | null;
  notes: string | null;
  decided_at: string;
}

/** Clean-stage non-destructive removal of a row (participant) or column (item). */
export interface CleanExclusionRow {
  id: string;
  cycle_id: string;
  assessment_id: string;
  kind: "row" | "col";
  target_id: string;
  decided_by: string;
  decided_at: string;
}

export interface ScoreRunRow {
  id: string;
  cycle_id: string;
  assessment_id: string;
  excluded_item_ids: string[];
  engine_version: string;
  computed_at: string;
}

export interface ParticipantScoreRow {
  id: string;
  score_run_id: string;
  participant_id: string;
  assessment_id: string;
  raw: number;
  pct: number;
  items_seen: number;
}

export interface GradeSchemeRow {
  id: string;
  cycle_id: string;
  scope: string; // assessment_id (uuid) | "overall"
  method: SchemeMethod;
  bands: GradeBand[];
  created_at: string;
  updated_at: string;
}

export interface GradeRow {
  id: string;
  cycle_id: string;
  participant_id: string;
  scope: string;
  grade_label: string | null;
  score: number | null;
  locked: boolean;
  signed_off_by: string | null;
  signed_off_at: string | null;
}

export interface ImportBatchRow {
  id: string;
  cycle_id: string;
  file_ref: string | null;
  /** Combined size (MB) of the uploaded export set — migration 0009. */
  file_size_mb: number | null;
  parsed_rows: number | null;
  validation_passed: boolean;
  report_json: unknown | null;
  // 3-CSV source filenames + reconciliation counts — migration 0006.
  items_file: string | null;
  assessments_file: string | null;
  topics_file: string | null;
  results_total: number | null;
  results_reconciled: number | null;
  created_by: string;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  cycle_id: string | null;
  actor_id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown | null;
  after: unknown | null;
  ts: string;
}

// --- 0003: adjustments / essays / config tables -----------------------------
export interface EssayMarkRow {
  id: string;
  cycle_id: string;
  participant_id: string;
  assessment_id: string;
  mark: number;
  essays_counted: number;
  file_ref: string | null;
  decided_by: string | null;
  decided_at: string;
}

export interface IncidentRow {
  id: string;
  cycle_id: string;
  source: IncidentSource;
  student_name: string | null;
  exam: string | null;
  issue_type: string | null;
  action_taken: string | null;
  questions_affected: string | null;
  staff: string | null;
  email: string | null;
  school: string | null;
  description: string | null;
  created_at: string;
}

export interface AlterationRow {
  id: string;
  cycle_id: string;
  incident_id: string | null;
  apply_to: AlterationApply;
  participant_id: string | null;
  assessment_id: string | null;
  marks: number;
  reason: string | null;
  decided_by: string | null;
  decided_at: string;
}

export interface DistinctionStateRow {
  cycle_id: string;
  confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface DistinctionOverrideRow {
  id: string;
  cycle_id: string;
  participant_id: string;
  scope: string;
  reason: string;
  decided_by: string | null;
  decided_at: string;
}

export interface DocumentSettingsRow {
  cycle_id: string;
  settings: Record<string, unknown>;
  updated_at: string;
}

export interface WorkspaceSettingRow {
  key: string;
  value: unknown;
  updated_at: string;
}

// --- Helper to describe a table to the Supabase client -----------------------
type TableDef<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

/**
 * The `Database` type consumed by `@supabase/supabase-js`. Insert/Update types
 * omit server-defaulted and definer-only columns where appropriate, but the key
 * guarantee that protected columns are not writable is enforced in the database
 * (RLS + column GRANTs), not the type system.
 */
export interface Database {
  public: {
    Tables: {
      // 0010 — top-level scoping dimension. Writes are definer-only (RPCs).
      test_centres: TableDef<TestCentreRow, never, never>;
      // 0005 — exam_years group the per-sitting exam_cycles pipeline runs.
      exam_years: TableDef<
        ExamYearRow,
        Pick<ExamYearRow, "name"> & Partial<Pick<ExamYearRow, "region">>,
        Partial<Pick<ExamYearRow, "name" | "region">>
      >;
      exam_cycles: TableDef<
        ExamCycleRow,
        Pick<ExamCycleRow, "name"> &
          Partial<Pick<ExamCycleRow, "region" | "year_id" | "sitting">>,
        Partial<Pick<ExamCycleRow, "name" | "region" | "year_id" | "sitting">>
      >;
      memberships: TableDef<
        MembershipRow,
        Pick<MembershipRow, "cycle_id" | "user_id" | "role">,
        Partial<Pick<MembershipRow, "role">>
      >;
      assessments: TableDef<
        AssessmentRow,
        Pick<AssessmentRow, "cycle_id" | "name"> &
          Partial<Pick<AssessmentRow, "item_count">>,
        Partial<Pick<AssessmentRow, "name" | "item_count">>
      >;
      items: TableDef<
        ItemRow,
        Omit<ItemRow, "id" | "status" | "created_at"> &
          Partial<Pick<ItemRow, "max_score">>,
        Partial<
          Pick<
            ItemRow,
            | "wording"
            | "major_element"
            | "sub_element"
            | "demand_level"
            | "max_score"
          >
        >
      >;
      item_stats: TableDef<ItemStatsRow, never, never>;
      participants: TableDef<
        ParticipantRow,
        Omit<ParticipantRow, "id" | "created_at">,
        Partial<Omit<ParticipantRow, "id" | "cycle_id" | "created_at">>
      >;
      responses: TableDef<
        ResponseRow,
        Omit<ResponseRow, "id" | "created_at">,
        never
      >;
      item_reviews: TableDef<
        ItemReviewRow,
        Pick<ItemReviewRow, "item_id" | "exclude"> &
          Partial<Pick<ItemReviewRow, "reason" | "notes">>,
        Partial<Pick<ItemReviewRow, "exclude" | "reason" | "notes">>
      >;
      // 0008 — clean-stage removals. All writes flow through SECURITY DEFINER RPCs.
      clean_exclusions: TableDef<CleanExclusionRow, never, never>;
      score_runs: TableDef<
        ScoreRunRow,
        Pick<ScoreRunRow, "cycle_id" | "assessment_id" | "engine_version"> &
          Partial<Pick<ScoreRunRow, "excluded_item_ids">>,
        Partial<Pick<ScoreRunRow, "excluded_item_ids">>
      >;
      participant_scores: TableDef<ParticipantScoreRow, never, never>;
      grade_schemes: TableDef<
        GradeSchemeRow,
        Pick<GradeSchemeRow, "cycle_id" | "scope" | "method" | "bands">,
        Partial<Pick<GradeSchemeRow, "method" | "bands">>
      >;
      grades: TableDef<
        GradeRow,
        Pick<GradeRow, "cycle_id" | "participant_id" | "scope"> &
          Partial<Pick<GradeRow, "grade_label" | "score">>,
        Partial<Pick<GradeRow, "grade_label" | "score">>
      >;
      import_batches: TableDef<
        ImportBatchRow,
        Pick<ImportBatchRow, "cycle_id"> &
          Partial<Pick<ImportBatchRow, "file_ref" | "parsed_rows">>,
        never
      >;
      audit_log: TableDef<AuditLogRow, never, never>;
      // 0003 — all writes flow through SECURITY DEFINER RPCs, so no client Insert/Update.
      essay_marks: TableDef<EssayMarkRow, never, never>;
      incidents: TableDef<IncidentRow, never, never>;
      alterations: TableDef<AlterationRow, never, never>;
      distinction_state: TableDef<DistinctionStateRow, never, never>;
      distinction_overrides: TableDef<DistinctionOverrideRow, never, never>;
      document_settings: TableDef<DocumentSettingsRow, never, never>;
      workspace_settings: TableDef<WorkspaceSettingRow, never, never>;
    };
    Views: Record<string, never>;
    Functions: {
      // 0001
      create_cycle: { Args: { p_name: string; p_region?: string }; Returns: ExamCycleRow };
      // 0004 (extended in 0005 with year_id / sitting; in 0010 with test_centre_id)
      create_cycle_with_assessments: {
        Args: {
          p_name: string;
          p_region?: string;
          p_assessments?: unknown;
          p_year_id?: string | null;
          p_sitting?: SittingPeriod;
          p_test_centre_id?: string | null;
        };
        Returns: string;
      };
      // 0005 (extended in 0010 with test_centre_id) — create/find an exam year.
      create_exam_year: {
        Args: { p_name: string; p_region?: string; p_test_centre_id?: string | null };
        Returns: ExamYearRow;
      };
      // 0010 — test centre management (definer-only writes).
      create_test_centre: {
        Args: { p_name: string; p_code: string; p_slug?: string | null; p_region?: string };
        Returns: TestCentreRow;
      };
      update_test_centre: {
        Args: { p_id: string; p_name?: string | null; p_code?: string | null; p_active?: boolean | null };
        Returns: TestCentreRow;
      };
      set_test_centre_active: {
        Args: { p_id: string; p_active: boolean };
        Returns: TestCentreRow;
      };
      set_cycle_status: { Args: { p_cycle: string; p_status: CycleStatus }; Returns: ExamCycleRow };
      set_assessment_status: { Args: { p_assessment: string; p_status: AssessmentStatus }; Returns: undefined };
      decide_item_exclusion: { Args: { p_item: string; p_exclude: boolean; p_reason: string | null; p_notes?: string | null }; Returns: undefined };
      set_clean_removal: { Args: { p_cycle: string; p_assessment: string; p_kind: string; p_targets: string[]; p_remove: boolean }; Returns: undefined };
      clear_clean_removals: { Args: { p_cycle: string; p_assessment: string }; Returns: undefined };
      write_item_stats: { Args: { p_cycle: string; p_engine_version: string; p_stats: unknown }; Returns: undefined };
      lock_grades: { Args: { p_cycle: string }; Returns: undefined };
      unlock_grades: { Args: { p_cycle: string; p_reason: string }; Returns: undefined };
      set_import_validation: { Args: { p_batch: string; p_passed: boolean; p_report: unknown }; Returns: undefined };
      record_export: { Args: { p_cycle: string; p_kind: string }; Returns: undefined };
      save_grade_scheme: { Args: { p_cycle: string; p_scope: string; p_method: SchemeMethod; p_bands: unknown }; Returns: GradeSchemeRow };
      // 0003
      write_scores: { Args: { p_cycle: string; p_engine_version: string; p_runs: unknown }; Returns: undefined };
      upsert_essay_marks: { Args: { p_cycle: string; p_file_ref: string | null; p_marks: unknown }; Returns: undefined };
      clear_essay_marks: { Args: { p_cycle: string }; Returns: undefined };
      insert_incidents: { Args: { p_cycle: string; p_rows: unknown }; Returns: undefined };
      clear_incidents: { Args: { p_cycle: string }; Returns: undefined };
      decide_incident: { Args: { p_cycle: string; p_incident: string; p_apply_to: AlterationApply; p_participant: string | null; p_assessment: string | null; p_marks: number; p_reason: string | null }; Returns: undefined };
      confirm_distinction_caps: { Args: { p_cycle: string }; Returns: undefined };
      override_distinction_cap: { Args: { p_cycle: string; p_participant: string; p_scope: string; p_reason: string }; Returns: undefined };
      undo_distinction_override: { Args: { p_cycle: string; p_participant: string; p_scope: string }; Returns: undefined };
      adjust_participant_mark: { Args: { p_cycle: string; p_participant: string; p_assessment: string; p_new_mark: number; p_reason: string }; Returns: string | null };
      remove_mark_adjustment: { Args: { p_cycle: string; p_participant: string; p_assessment: string }; Returns: undefined };
      set_document_settings: { Args: { p_cycle: string; p_settings: unknown }; Returns: undefined };
      record_documents: { Args: { p_cycle: string; p_detail: string }; Returns: undefined };
      set_workspace_setting: { Args: { p_key: string; p_value: unknown }; Returns: undefined };
      // 0007 — atomic, idempotent 3-CSV persist + destructive sitting controls.
      ingest_persist: { Args: { p_cycle: string; p_payload: unknown; p_actor: string }; Returns: unknown };
      clear_sitting_data: { Args: { p_cycle: string }; Returns: undefined };
      delete_sitting: { Args: { p_cycle: string }; Returns: undefined };
    };
    Enums: {
      cycle_status: CycleStatus;
      assessment_status: AssessmentStatus;
      item_status: ItemStatus;
      member_role: MemberRole;
      quality_rating: QualityRating;
      demand_level: DemandLevel;
      scheme_method: SchemeMethod;
      incident_source: IncidentSource;
      alteration_apply: AlterationApply;
    };
    CompositeTypes: Record<string, never>;
  };
}
