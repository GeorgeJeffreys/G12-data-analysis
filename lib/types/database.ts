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

// --- Reusable JSON shapes ----------------------------------------------------
export interface GradeBand {
  label: string;
  min: number;
  max: number;
}

// --- Table row shapes --------------------------------------------------------
export interface ExamCycleRow {
  id: string;
  name: string;
  status: CycleStatus;
  region: string;
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
  parsed_rows: number | null;
  validation_passed: boolean;
  report_json: unknown | null;
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
      exam_cycles: TableDef<
        ExamCycleRow,
        Pick<ExamCycleRow, "name"> & Partial<Pick<ExamCycleRow, "region">>,
        Partial<Pick<ExamCycleRow, "name" | "region">>
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      cycle_status: CycleStatus;
      assessment_status: AssessmentStatus;
      item_status: ItemStatus;
      member_role: MemberRole;
      quality_rating: QualityRating;
      demand_level: DemandLevel;
      scheme_method: SchemeMethod;
    };
    CompositeTypes: Record<string, never>;
  };
}
