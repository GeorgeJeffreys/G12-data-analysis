/**
 * Subnav (secondary tab bar) definitions for each nav area, mirroring the
 * batch-2 design (CYC_SUBNAV / AN_SUBNAV / SET_SUBNAV).
 */
import type { SubnavItem } from "@/components/shell/Shell";

export function cyclesSubnav(cycleId: string, active: "pipeline" | "audit" | "documents"): SubnavItem[] {
  return [
    { label: "Pipeline", href: `/cycles/${cycleId}`, on: active === "pipeline" },
    { label: "Audit log", href: `/cycles/${cycleId}/audit`, on: active === "audit" },
    { label: "Certificates", href: `/cycles/${cycleId}/documents`, on: active === "documents" },
  ];
}

export function analyticsSubnav(active: "trends" | "compare"): SubnavItem[] {
  return [
    { label: "Trends", href: "/analytics", on: active === "trends" },
    { label: "Compare cycles", href: "/analytics/compare", on: active === "compare" },
  ];
}

export function settingsSubnav(active: "users" | "roles" | "config"): SubnavItem[] {
  return [
    { label: "Users & access", href: "/settings/users", on: active === "users" },
    { label: "Roles & permissions", href: "/settings/roles", on: active === "roles" },
    { label: "Configuration", href: "/settings/config", on: active === "config" },
  ];
}
