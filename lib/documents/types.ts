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
}
