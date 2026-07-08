/**
 * Authorization foundation (X1) — a plain **role × action** grid. Two honest halves:
 *
 *   * ACTIONS — the FIXED catalogue of gateable operations (this file is code, never
 *     edited at runtime). Each action is one line of enforcement; adding a brand-new
 *     action still needs a dev. Grouped by pipeline step (+ a General bucket).
 *   * ROLES + ROLE_ACTIONS — fully editable at runtime: roles are add/deletable rows
 *     and each cell (`role × action`) is a toggle. The seed below reproduces today's
 *     effective access, but nothing here is load-bearing once an admin edits the grid.
 *
 * Enforcement resolves: membership `role_id` → the role's granted actions → the action
 * a gate checks. `can(user, action)` is the client twin of the DB's `app.can_do`; both
 * read the SAME roles + role_actions, and `can()` falls back to the seeded defaults
 * before hydration.
 *
 * This replaces the R1/R2 capability + permission-bundle layer wholesale.
 */

import { tierOfRole, type AnyRole } from "@/lib/auth/roles";

// ── Action catalogue (CODE — the fixed operations the app enforces) ──────────

/** One gateable action in the catalogue. `key` is what a gate checks via `can()`. */
export interface ActionDef {
  key: string;
  label: string;
  description: string;
  /** The pipeline step (or "General") this action belongs to — drives the grid UI. */
  group: string;
}

/**
 * The fixed catalogue, in catalogue order. Adding a key here requires adding the
 * enforcement that consults it — this is code, not user-editable data.
 */
export const ACTIONS = [
  // Upload
  { key: "upload.ingest",                group: "Upload",              label: "Ingest raw export",                      description: "Ingest / upload a Questionmark export." },
  { key: "upload.manage",                group: "Upload",              label: "Create / clear a sitting",               description: "Create a sitting; clear it for re-upload." },
  // Clean
  { key: "clean.rows",                   group: "Clean",               label: "Remove rows / columns",                  description: "Clean-stage row / column removal." },
  { key: "clean.cohort",                 group: "Clean",               label: "Exclude participants",                   description: "Cohort (staff / test) exclusion." },
  // Question Review
  { key: "review.exclude",               group: "Question Review",     label: "Exclude / restore items",                description: "Item exclusion at Question Review." },
  // Incident Adjustments
  { key: "incidents.upload",             group: "Incident Adjustments", label: "Upload incident / essay / technical logs", description: "Supplementary uploads (incident, essay, technical)." },
  { key: "incidents.triage",             group: "Incident Adjustments", label: "Triage incidents",                       description: "Decide / classify incidents." },
  { key: "incidents.apply",              group: "Incident Adjustments", label: "Apply adjustments to scores",            description: "Apply / unapply incident adjustments." },
  // Cut Scores
  { key: "cuts.set",                     group: "Cut Scores",          label: "Set cut scores",                         description: "Set / edit cut scores; waive guard-rails." },
  // CGJ
  { key: "cgj.upload",                   group: "CGJ",                 label: "Upload CGJ comparison",                  description: "Upload the CGJ comparison file." },
  // Grades
  { key: "grades.adjust",                group: "Grades",              label: "Adjust a student mark",                  description: "Manual mark adjustment (add / remove)." },
  { key: "grades.confirm_distinction",   group: "Grades",              label: "Confirm Distinction caps",               description: "Confirm the per-student Distinction gate." },
  // Awards
  { key: "awards.generate",              group: "Awards",              label: "Generate certificates / reports",        description: "Overall Award document generation." },
  // General
  { key: "general.view",                 group: "General",             label: "View everything",                        description: "Read every stage, analytics and reports." },
  { key: "general.signoff",              group: "General",             label: "Sign off (lock) a sitting",              description: "Lock / unlock a sitting." },
  { key: "general.override_marks",       group: "General",             label: "Approve / reverse marks & exclusions",   description: "Re-include an item / reverse a mark another user made." },
  { key: "general.override_distinction", group: "General",             label: "Approve / reverse a Distinction cap",    description: "Override a Distinction cap." },
  { key: "general.audit",                group: "General",             label: "View the audit log",                     description: "Audit history + effective state." },
  { key: "general.config_methodology",   group: "General",             label: "Configure methodology",                  description: "Quality / grading / cut-score policy, element labels, document settings." },
  { key: "general.config_incidents",     group: "General",             label: "Configure incident codes",               description: "Incident codes, formulae, cap, mapping." },
  { key: "general.manage_users",         group: "General",             label: "Manage users",                           description: "Invite / assign role / remove." },
  { key: "general.manage_roles",         group: "General",             label: "Manage roles",                           description: "Create / edit / delete roles + this grid." },
  { key: "general.manage_centres",       group: "General",             label: "Manage test centres",                    description: "Test-centre CRUD." },
  { key: "general.delete",               group: "General",             label: "Delete sittings / cycles",               description: "Destructive removal." },
] as const satisfies readonly ActionDef[];

export type ActionKey = (typeof ACTIONS)[number]["key"];

/** The action keys, as a plain array. */
export const ACTION_KEYS = ACTIONS.map((a) => a.key) as ActionKey[];

/** The ordered group list (pipeline steps + General) — the grid UI consumes this. */
export const ACTION_GROUP_ORDER = [
  "Upload",
  "Clean",
  "Question Review",
  "Incident Adjustments",
  "Cut Scores",
  "CGJ",
  "Grades",
  "Awards",
  "General",
] as const;

/** Actions grouped in catalogue order — one entry per pipeline step (+ General). */
export const ACTION_GROUPS: { group: string; items: ActionDef[] }[] = (() => {
  const byGroup = new Map<string, ActionDef[]>();
  for (const a of ACTIONS) {
    if (!byGroup.has(a.group)) byGroup.set(a.group, []);
    byGroup.get(a.group)!.push({ ...a });
  }
  return ACTION_GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({ group, items: byGroup.get(group)! }));
})();

// ── Roles + the grid (DATA — fully editable at runtime) ──────────────────────

/** A role row. `isSystem` marks the undeletable Admin role (lockout-guarded). */
export interface Role {
  id: string;
  name: string;
  isSystem: boolean;
  sort: number;
}

/** role_id → the set of actions that role holds. The resolved grid the gates read. */
export type ResolvedRoleActions = Record<string, Set<ActionKey>>;

/**
 * The two lockout-guarded actions the Admin role must always keep, and the Admin
 * role's stable id. Defence-in-depth: the DB RPCs enforce the same guards.
 */
export const MANAGE_ROLES_ACTION: ActionKey = "general.manage_roles";
export const MANAGE_USERS_ACTION: ActionKey = "general.manage_users";

/**
 * The three seeded roles. Ids are STABLE and deliberately equal to the canonical
 * privilege tiers (`team_member` / `analyst` / `admin`) so a membership carrying only
 * the legacy `member_role` enum resolves through `tierOfRole` → the seeded role id.
 * The DB assigns real uuids; the demo/tests use these stable strings.
 */
export const ADMIN_ROLE_ID = "admin";
export const DEFAULT_ROLES: Role[] = [
  { id: "team_member", name: "G12 team member", isSystem: false, sort: 0 },
  { id: "analyst",     name: "Data analyst",    isSystem: false, sort: 1 },
  { id: ADMIN_ROLE_ID, name: "Admin",           isSystem: true,  sort: 2 },
];

/**
 * The seeded grid — role_id → granted actions. Reproduces today's per-role EFFECTIVE
 * access, mapped from the R1 capability defaults:
 *   team_member (R1 view+clean+adjust) → view, clean.*, review.exclude, incidents.*, grades.adjust, cgj.upload
 *   analyst     (R1 +intake+boundaries+safeguard+audit) → team_member's + upload.*, cuts.set,
 *               grades.confirm_distinction, general.audit
 *   admin       → every action.
 */
const TEAM_MEMBER_ACTIONS: ActionKey[] = [
  "general.view",
  "clean.rows",
  "clean.cohort",
  "review.exclude",
  "incidents.upload",
  "incidents.triage",
  "incidents.apply",
  "grades.adjust",
  "cgj.upload",
];
const ANALYST_ACTIONS: ActionKey[] = [
  ...TEAM_MEMBER_ACTIONS,
  "upload.ingest",
  "upload.manage",
  "cuts.set",
  "grades.confirm_distinction",
  "general.audit",
];

/** Seeded role_id → granted action keys. Fully editable at runtime. */
export const DEFAULT_ROLE_ACTIONS: Record<string, ActionKey[]> = {
  team_member: [...TEAM_MEMBER_ACTIONS],
  analyst: [...ANALYST_ACTIONS],
  admin: [...ACTION_KEYS],
};

/** Deep-clone the seed roles (so a provider can mutate its own copy). */
export function defaultRoles(): Role[] {
  return DEFAULT_ROLES.map((r) => ({ ...r }));
}
/** Deep-clone the seed grid. */
export function defaultRoleActions(): Record<string, ActionKey[]> {
  const out: Record<string, ActionKey[]> = {};
  for (const [id, acts] of Object.entries(DEFAULT_ROLE_ACTIONS)) out[id] = [...acts];
  return out;
}

// ── Resolution (role_id → granted actions) ───────────────────────────────────

/** Resolve roles + a role_id→actions map into each role's effective action set. */
export function resolveRoleActions(
  roles: readonly Pick<Role, "id">[],
  roleActions: Record<string, readonly ActionKey[]>,
): ResolvedRoleActions {
  const out: ResolvedRoleActions = {};
  for (const role of roles) out[role.id] = new Set(roleActions[role.id] ?? []);
  return out;
}

/** The seeded default resolution — the pre-hydration fallback for `can()`. */
export const DEFAULT_RESOLVED_ACTIONS: ResolvedRoleActions = resolveRoleActions(DEFAULT_ROLES, DEFAULT_ROLE_ACTIONS);

// ── The checker ──────────────────────────────────────────────────────────────

/**
 * A user for `can()`: either an object carrying a `roleId` (the new spine) and/or a
 * legacy `role` (`member_role`/tier), or a bare role string. A `roleId` wins; a bare
 * role / `.role` collapses to its seeded role id via `tierOfRole`.
 */
export type CanUser = { roleId?: string | null; role?: AnyRole | null } | AnyRole;

/** The seeded role id a user resolves to (uuid `roleId` wins; else tier of the enum). */
export function roleIdOf(user: CanUser): string {
  if (typeof user === "string") return tierOfRole(user);
  if (user.roleId) return user.roleId;
  if (user.role) return tierOfRole(user.role);
  return "team_member";
}

/**
 * Does `user` hold `action`? Resolves the user's role id and checks the granted set.
 * Uses the hydrated `resolved` grid when supplied; otherwise the seeded defaults (so
 * the answer is correct before hydration). If the hydrated grid has no row for the
 * user's role id, falls back to the seeded set for that id.
 *
 * Client twin of the DB `app.can_do`.
 */
export function can(user: CanUser, action: ActionKey, resolved?: ResolvedRoleActions): boolean {
  const id = roleIdOf(user);
  const set = resolved?.[id] ?? DEFAULT_RESOLVED_ACTIONS[id];
  return set ? set.has(action) : false;
}
