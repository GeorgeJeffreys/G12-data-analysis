/**
 * Document-generation contract. The UI depends only on `DocumentGenerator` and
 * these types — never on the Python renderer or LibreOffice directly.
 */
import type { DocSettings, StudentSummary } from "@/lib/data/types";

export type DocKind = "certificate" | "report" | "unofficial";

export interface GenerateRequest {
  cycleId: string;
  kinds: DocKind[];
  /** The Student Summary built from the locked-grades read-model. */
  students: StudentSummary[];
  settings: DocSettings;
  /** Uploaded PowerPoint templates, one per requested kind. */
  templates: Partial<Record<DocKind, ArrayBuffer>>;
  /**
   * When true, render a DRAFT proof rather than an official certificate: the
   * same templates and tokens, watermarked and filename-prefixed so the output
   * can never be mistaken for an issued document. Real (non-draft) issuance is
   * gated on the O1/O2 methodology sign-off — see `IssuanceSignOff`.
   */
  draft?: boolean;
}

export interface FontInfo {
  georgiaPresent: boolean;
  barlowPresent: boolean;
  warnings: string[];
}

export interface KindResult {
  complete: number;
  total: number;
  zipUrl?: string;
  error?: string;
}

export type DocStatus = "complete" | "error";

export interface PerStudentDoc {
  status: DocStatus;
  error?: string;
  downloadUrl?: string;
}

export interface PerStudentStatus {
  id: string;
  name: string;
  award: string;
  results: Partial<Record<DocKind, PerStudentDoc>>;
}

export interface GenerateResult {
  jobId: string;
  fonts: FontInfo;
  kinds: Partial<Record<DocKind, KindResult>>;
  perStudent: PerStudentStatus[];
  /** Object URL of the single combined .zip of all generated .pptx files. */
  zipUrl?: string;
  /** Suggested download filename for the combined zip. */
  zipName?: string;
}
