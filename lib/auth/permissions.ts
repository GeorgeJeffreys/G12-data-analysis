/**
 * Permission foundation — the fixed registry of gateable action domains and the
 * editable role → permission map that decides who may perform each one.
 *
 * This module is the CLIENT twin of the DB's `app.has_permission` (migration
 * 0036). Both read the SAME role_permissions matrix: the server function reads
 * the `role_permissions` table, and `can()` reads the map hydrated FROM that
 * table (falling back to `ROLE_PERMISSION_DEFAULTS` before hydration, or on a
 * fresh DB whose table is still empty).
 *
 * Two kinds of data live here, and the distinction is load-bearing:
 *   * PERMISSIONS — the fixed set of action domains. New keys are CODE, not user
 *     data: adding one means adding new enforcement, so the list is defined here
 *     and never edited at runtime.
 *   * ROLE_PERMISSION_DEFAULTS — a sensible STARTING POINT for which tier gets
 *     which permission. Fully editable in the matrix UI (P3) and persisted to the
 *     DB, so the exact cells are not load-bearing.
 *
 * This is additive: `can()` is defined but not yet consulted by any existing
 * `hasRole` gate. P2 flips enforcement onto it; P3 makes the matrix editable.
 */

import { tierOfRole, type AnyRole, type RoleTier } from "@/lib/auth/roles";

/**
 * The fixed set of gateable permissions — each a distinct action domain the app
 * enforces on. Adding a key here requires adding the enforcement that consults
 * it, so this list is code, not user-editable data.
 */
export const PERMISSIONS = [
  "view",            // read every pipeline stage, analytics, reports
  "intake",          // ingest raw export, create/clear a sitting (re-upload)
  "clean",           // item exclusion, clean row/col removal, cohort exclusion
  "adjust",          // essay/incident/technical uploads, incident triage, mark adjustment, apply incident adjustments
  "boundaries",      // set/edit cut scores, waive guard-rails
  "safeguard",       // confirm/override Distinction caps
  "signoff",         // lock / unlock a sitting
  "override",        // reverse another user's grade-bearing decision
  "configure",       // methodology config, incident-code config, element labels, document settings
  "workspace_admin", // users & roles (incl. editing THIS matrix), test centres, sitting/cycle deletion
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type { RoleTier } from "@/lib/auth/roles";

/**
 * Sensible starting point — fully editable in the UI (P3) and persisted to the
 * DB, so exact cells are not load-bearing. admin holds every permission.
 */
export const ROLE_PERMISSION_DEFAULTS: Record<RoleTier, Permission[]> = {
  team_member: ["view", "clean", "adjust"],
  analyst:     ["view", "clean", "adjust", "intake", "boundaries", "safeguard"],
  admin:       [...PERMISSIONS], // all
};

/** Grouping + human labels for the matrix UI (P3 consumes this). */
export const PERMISSION_GROUPS: { group: string; items: { id: Permission; label: string }[] }[] = [
  { group: "Data", items: [ {id:"intake",label:"Upload / ingest & manage sittings"}, {id:"clean",label:"Clean data & exclude items/participants"} ] },
  { group: "Grading", items: [ {id:"adjust",label:"Adjustments & mark changes"}, {id:"boundaries",label:"Set cut scores"}, {id:"safeguard",label:"Distinction safeguard"}, {id:"signoff",label:"Sign off (lock) a sitting"}, {id:"override",label:"Override another user's decision"} ] },
  { group: "Administration", items: [ {id:"configure",label:"Configure methodology & incidents"}, {id:"workspace_admin",label:"Manage users, roles, centres & deletion"} ] },
  { group: "Base", items: [ {id:"view",label:"View everything (read-only)"} ] },
];

/**
 * Permissions that must always remain granted to `admin` so the workspace can
 * never be locked out of managing its own users, roles and this very matrix.
 * Both `setRolePermission` guards (client + server) refuse to ungrant these.
 */
export const ADMIN_LOCKED_PERMISSIONS: Permission[] = ["workspace_admin"];

/**
 * The effective, hydrated map: for each canonical tier, the set of permissions
 * it currently holds. Built from the DB's role_permissions matrix; `can()` reads
 * this when supplied and falls back to the defaults otherwise.
 */
export type RolePermissionMap = Record<RoleTier, Set<Permission>>;

/** Build a `RolePermissionMap` from the defaults (used as the pre-hydration fallback). */
export function defaultRolePermissionMap(): RolePermissionMap {
  return {
    team_member: new Set(ROLE_PERMISSION_DEFAULTS.team_member),
    analyst: new Set(ROLE_PERMISSION_DEFAULTS.analyst),
    admin: new Set(ROLE_PERMISSION_DEFAULTS.admin),
  };
}

/** Is `permission` an admin-locked one (never ungrantable from `admin`)? */
export function isAdminLocked(permission: Permission): boolean {
  return ADMIN_LOCKED_PERMISSIONS.includes(permission);
}

/**
 * Does `role` hold `permission`? Resolves the role to its canonical tier and
 * checks the effective map. When no hydrated `map` is supplied it falls back to
 * `ROLE_PERMISSION_DEFAULTS`, so the answer is correct even before hydration.
 *
 * This is the client twin of the DB `app.has_permission`. Additive for now — no
 * existing gate consults it yet (P2 does the swap).
 */
export function can(role: AnyRole, permission: Permission, map?: RolePermissionMap): boolean {
  const tier = tierOfRole(role);
  if (map) return map[tier].has(permission);
  return ROLE_PERMISSION_DEFAULTS[tier].includes(permission);
}
