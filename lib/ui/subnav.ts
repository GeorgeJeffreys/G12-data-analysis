/**
 * Subnav (secondary tab bar) definitions for each nav area, mirroring the
 * batch-2 design (CYC_SUBNAV / AN_SUBNAV / SET_SUBNAV).
 */
import type { SubnavItem } from "@/components/shell/Shell";

// No per-sitting "Certificates" tab: certificates & performance reports issue from
// the cycle/overall best-of-two award (app/years/[yearId]/overall/documents), not an
// individual sitting. The `documents` area is retained in the type only for back-compat.
export function cyclesSubnav(cycleId: string, active: "pipeline" | "audit" | "documents" | "diagnostics"): SubnavItem[] {
  return [
    { label: "Pipeline", href: `/cycles/${cycleId}`, on: active === "pipeline" },
    { label: "Audit log", href: `/cycles/${cycleId}/audit`, on: active === "audit" },
    // Sitting-level Diagnostics tab (distinct from the per-subject Diagnostics
    // pipeline step at /diagnostics). Placeholder for now — content to follow.
    { label: "Diagnostics", href: `/cycles/${cycleId}/diagnostics-hub`, on: active === "diagnostics" },
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
