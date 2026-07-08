/**
 * Subnav (secondary tab bar) definitions for each nav area, mirroring the
 * batch-2 design (CYC_SUBNAV / AN_SUBNAV / SET_SUBNAV).
 */
import type { SubnavItem } from "@/components/shell/Shell";

// No per-sitting "Certificates" tab: certificates & performance reports issue from
// the cycle/overall best-of-two award (app/years/[yearId]/overall/documents), not an
// individual sitting. The `documents` area is retained in the type only for back-compat.
export function cyclesSubnav(
  cycleId: string,
  active: "pipeline" | "audit" | "documents" | "diagnostics" | "dataflow" | "settings",
  /** Append the admin-only "Data flow" developer tab (task 15). `audit` gates the
   *  Audit log tab on the `audit.view` capability (0039). */
  opts?: { dataFlow?: boolean; audit?: boolean },
): SubnavItem[] {
  return [
    // "Critical Path" is the per-sitting pipeline (Upload → … → Grades). Renamed
    // from "Pipeline" so the tab name matches how the team refers to it.
    { label: "Critical Path", href: `/cycles/${cycleId}`, on: active === "pipeline" },
    // The Audit log tab appears only for roles holding `audit.view`.
    ...(opts?.audit ? [{ label: "Audit log", href: `/cycles/${cycleId}/audit`, on: active === "audit" }] : []),
    // Sitting-level "Diagnostics" reference tab — the single home for exploratory /
    // demand-level breakdowns. No longer ambiguous: the in-critical-path check is
    // the whole-assessment "Assessment Health" step (/diagnostics), so this is the
    // only user-facing "Diagnostics".
    { label: "Diagnostics", href: `/cycles/${cycleId}/diagnostics-hub`, on: active === "diagnostics" },
    // Developer "Data flow" pipeline inspector — admin-only, so it appears only when
    // the shell says the signed-in user is a top admin.
    ...(opts?.dataFlow ? [{ label: "Data flow", href: `/cycles/${cycleId}/data-flow`, on: active === "dataflow" }] : []),
    // Cycle Settings — home of the cycle-level danger surface (delete cycle). The
    // destructive action inside is admin-gated; the tab itself is always reachable.
    { label: "Settings", href: `/cycles/${cycleId}/settings`, on: active === "settings" },
  ];
}

export function analyticsSubnav(active: "trends" | "compare"): SubnavItem[] {
  return [
    { label: "Trends", href: "/analytics", on: active === "trends" },
    { label: "Compare cycles", href: "/analytics/compare", on: active === "compare" },
  ];
}

export function settingsSubnav(
  active: "users" | "roles" | "centres" | "config" | "elements" | "incidents",
): SubnavItem[] {
  return [
    { label: "Users & access", href: "/settings/users", on: active === "users" },
    { label: "Roles & permissions", href: "/settings/roles", on: active === "roles" },
    { label: "Test centres", href: "/settings/test-centres", on: active === "centres" },
    { label: "Configuration", href: "/settings/config", on: active === "config" },
    { label: "Incident adjustments", href: "/settings/incident-adjustments", on: active === "incidents" },
    { label: "Element labels", href: "/settings/elements", on: active === "elements" },
  ];
}
