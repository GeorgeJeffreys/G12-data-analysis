/**
 * Result-status helpers. A QM sitting carries a `result_status` flag describing
 * how the attempt finished — normally 'Finished OK', but sometimes a technical
 * fault such as 'Finished Abnormally' or 'Time Limit Exceeded'. We surface a
 * per-student count of these technical incidents (display only — it never
 * changes a score or grade), derived from the flags already in the data.
 */

/** Statuses that represent a clean, normal completion (NOT a technical incident). */
const NORMAL_STATUSES = new Set(["finished ok", "finished", "completed", "submitted"]);

/**
 * True when a result-status flag indicates the sitting did not finish cleanly —
 * e.g. 'Finished Abnormally', 'Time Limit Exceeded'. Empty / normal statuses are
 * not incidents. Pure classification of existing data; no scoring impact.
 */
export function isTechnicalIncidentStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  if (s === "") return false;
  return !NORMAL_STATUSES.has(s);
}
