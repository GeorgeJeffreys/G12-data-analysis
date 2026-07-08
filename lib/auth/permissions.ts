/**
 * Authorization foundation — a fixed CAPABILITY catalogue (code) plus an
 * admin-editable PERMISSION layer (data) that sits between roles and capabilities.
 *
 * The load-bearing distinction:
 *   * CAPABILITIES — the fixed set of operations the app actually enforces. Each
 *     capability is a line of enforcement; adding one is a DEV task. This list is
 *     code, never edited at runtime.
 *   * PERMISSIONS — admin-defined, NAMED bundles of capabilities, fully editable
 *     at runtime (create/compose/grant in the UI, persisted to the DB). The seed
 *     below reproduces today's access, but the exact bundles are not load-bearing.
 *   * ROLE GRANTS — which permissions each canonical tier holds.
 *
 * Enforcement always resolves: role → granted permissions → union of their
 * capabilities → the capability the gate checks. `can()` is the client twin of the
 * DB's `app.has_capability`; both read the SAME permissions + role_grants, and
 * `can()` falls back to the seeded defaults before hydration.
 */

import { tierOfRole, ROLE_TIERS, type AnyRole, type RoleTier } from "@/lib/auth/roles";

// ── Capability catalogue (CODE — the fixed operations the app enforces) ──────

/** One capability in the catalogue. `key` is what a gate checks via `can()`. */
export interface CapabilityDef {
  key: string;
  label: string;
  group: string;
  description: string;
}

/**
 * The fixed catalogue. Adding a key here requires adding the enforcement that
 * consults it — this is code, not user-editable data.
 */
export const CAPABILITIES = [
  { key: "view",                     group: "Base",           label: "View everything",              description: "Read every pipeline stage, analytics and reports." },
  { key: "audit.view",               group: "Base",           label: "Audit access",                 description: "Open the Audit log and effective-state surface (read-only)." },
  { key: "intake",                   group: "Data",           label: "Upload / ingest & manage sittings", description: "Ingest a raw export; create/clear a sitting (re-upload)." },
  { key: "clean",                    group: "Data",           label: "Clean data & exclude items/participants", description: "Item exclusion, clean row/col removal, cohort exclusion." },
  { key: "adjust",                   group: "Grading",        label: "Adjustments & mark changes",   description: "Essay/incident/technical uploads, incident triage, mark adjustment, apply incident adjustments." },
  { key: "boundaries",               group: "Grading",        label: "Set cut scores",               description: "Set/edit cut scores; waive guard-rails." },
  { key: "safeguard",                group: "Grading",        label: "Distinction safeguard",        description: "Confirm the Distinction caps." },
  { key: "signoff",                  group: "Grading",        label: "Sign off (lock) a sitting",    description: "Lock / unlock a sitting." },
  { key: "override.marks_exclusions", group: "Grading",       label: "Override marks & exclusions",  description: "Re-include an item another user excluded / reverse a mark adjustment." },
  { key: "override.distinction",     group: "Grading",        label: "Override Distinction cap",     description: "Override the Distinction cap for a student." },
  { key: "configure",                group: "Administration", label: "Configure methodology & incidents", description: "Methodology config, incident-code config, element labels, document settings." },
  { key: "workspace_admin",          group: "Administration", label: "Manage users, roles, centres & deletion", description: "Users & permissions, test centres, sitting/cycle deletion." },
] as const satisfies readonly CapabilityDef[];

export type Capability = (typeof CAPABILITIES)[number]["key"];

/** The capability keys, as a plain array. */
export const CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key) as Capability[];

/** Capabilities grouped in catalogue order (the permission-composer UI consumes this). */
export const CAPABILITY_GROUPS: { group: string; items: CapabilityDef[] }[] = (() => {
  const order: string[] = [];
  const byGroup = new Map<string, CapabilityDef[]>();
  for (const c of CAPABILITIES) {
    if (!byGroup.has(c.group)) { byGroup.set(c.group, []); order.push(c.group); }
    byGroup.get(c.group)!.push(c);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
})();

/** The capability every workspace must retain (via the system permission) so an
 *  admin can never be locked out of managing users, permissions and centres. */
export const WORKSPACE_ADMIN_CAPABILITY: Capability = "workspace_admin";

export type { RoleTier } from "@/lib/auth/roles";

// ── Permission layer (DATA — admin-editable bundles of capabilities) ─────────

/** An admin-defined, named bundle of capabilities. `isSystem` marks the protected
 *  Workspace-administration permission (see the lockout guard). */
export interface Permission {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  isSystem: boolean;
}

/** Which permission ids each canonical tier is granted. */
export type RoleGrants = Record<RoleTier, string[]>;

/** Stable seed ids (the DB assigns real uuids; the demo/tests use these). */
export const SEED_PERMISSION_IDS = {
  view: "perm-view",
  intake: "perm-intake",
  clean: "perm-clean",
  adjust: "perm-adjust",
  boundaries: "perm-boundaries",
  safeguard: "perm-safeguard",
  signoff: "perm-signoff",
  overrides: "perm-overrides",
  audit: "perm-audit",
  configure: "perm-configure",
  workspaceAdmin: "perm-workspace-admin",
} as const;

/** Seed permission set — reproduces today's access. Fully editable at runtime. */
export const DEFAULT_PERMISSIONS: Permission[] = [
  { id: SEED_PERMISSION_IDS.view,       name: "View",                     description: "Read-only access to every stage, analytics and reports.", capabilities: ["view"], isSystem: false },
  { id: SEED_PERMISSION_IDS.intake,     name: "Data intake",              description: "Upload / ingest and manage sittings.",                   capabilities: ["intake"], isSystem: false },
  { id: SEED_PERMISSION_IDS.clean,      name: "Data cleaning",            description: "Clean data and exclude items/participants.",             capabilities: ["clean"], isSystem: false },
  { id: SEED_PERMISSION_IDS.adjust,     name: "Adjustments",              description: "Adjustments and mark changes.",                          capabilities: ["adjust"], isSystem: false },
  { id: SEED_PERMISSION_IDS.boundaries, name: "Cut scores",               description: "Set grade cut scores.",                                  capabilities: ["boundaries"], isSystem: false },
  { id: SEED_PERMISSION_IDS.safeguard,  name: "Distinction safeguard",    description: "Confirm the Distinction caps.",                          capabilities: ["safeguard"], isSystem: false },
  { id: SEED_PERMISSION_IDS.signoff,    name: "Sign-off",                 description: "Lock / sign off a sitting.",                             capabilities: ["signoff"], isSystem: false },
  { id: SEED_PERMISSION_IDS.overrides,  name: "Overrides",                description: "Override another user's grade-bearing decisions.",       capabilities: ["override.marks_exclusions", "override.distinction"], isSystem: false },
  { id: SEED_PERMISSION_IDS.audit,      name: "Audit access",             description: "Open the Audit log and effective-state surface.",        capabilities: ["audit.view"], isSystem: false },
  { id: SEED_PERMISSION_IDS.configure,  name: "Configuration",            description: "Configure methodology and incidents.",                   capabilities: ["configure"], isSystem: false },
  { id: SEED_PERMISSION_IDS.workspaceAdmin, name: "Workspace administration", description: "Manage users, permissions, centres and deletion.",   capabilities: ["workspace_admin"], isSystem: true },
];

/** Seed grants — reproduce the current effective access per tier. */
export const DEFAULT_ROLE_GRANTS: RoleGrants = {
  team_member: [SEED_PERMISSION_IDS.view, SEED_PERMISSION_IDS.clean, SEED_PERMISSION_IDS.adjust],
  analyst: [
    SEED_PERMISSION_IDS.view, SEED_PERMISSION_IDS.clean, SEED_PERMISSION_IDS.adjust,
    SEED_PERMISSION_IDS.intake, SEED_PERMISSION_IDS.boundaries, SEED_PERMISSION_IDS.safeguard,
    SEED_PERMISSION_IDS.audit,
  ],
  admin: DEFAULT_PERMISSIONS.map((p) => p.id), // all
};

// ── Resolution (role → granted permissions → union of capabilities) ──────────

/** The resolved effective capabilities each tier holds. */
export type ResolvedGrants = Record<RoleTier, Set<Capability>>;

/** Resolve permissions + role grants into each tier's effective capability set. */
export function resolveGrants(permissions: Permission[], grants: RoleGrants): ResolvedGrants {
  const byId = new Map(permissions.map((p) => [p.id, p]));
  const out = {} as ResolvedGrants;
  for (const tier of ROLE_TIERS) {
    const caps = new Set<Capability>();
    for (const permId of grants[tier] ?? []) {
      for (const cap of byId.get(permId)?.capabilities ?? []) caps.add(cap);
    }
    out[tier] = caps;
  }
  return out;
}

/** The seeded default resolution — the pre-hydration fallback for `can()`. */
export const DEFAULT_RESOLVED_GRANTS: ResolvedGrants = resolveGrants(DEFAULT_PERMISSIONS, DEFAULT_ROLE_GRANTS);

/** Deep-clone the seed permission set (so a provider can mutate its own copy). */
export function defaultPermissions(): Permission[] {
  return DEFAULT_PERMISSIONS.map((p) => ({ ...p, capabilities: [...p.capabilities] }));
}
/** Deep-clone the seed role grants. */
export function defaultRoleGrants(): RoleGrants {
  return { team_member: [...DEFAULT_ROLE_GRANTS.team_member], analyst: [...DEFAULT_ROLE_GRANTS.analyst], admin: [...DEFAULT_ROLE_GRANTS.admin] };
}

// ── The checker + lockout helpers ────────────────────────────────────────────

/**
 * Does `role` hold `capability`? Resolves the role to its tier and checks the
 * resolved capability set. Falls back to the seeded defaults when no hydrated
 * `resolved` map is supplied, so the answer is correct even before hydration.
 *
 * Client twin of the DB `app.has_capability`.
 */
export function can(role: AnyRole, capability: Capability, resolved?: ResolvedGrants): boolean {
  const tier = tierOfRole(role);
  return (resolved ?? DEFAULT_RESOLVED_GRANTS)[tier].has(capability);
}

/** Is this the protected Workspace-administration permission (guards workspace_admin)? */
export function guardsWorkspaceAdmin(p: Permission): boolean {
  return p.isSystem && p.capabilities.includes(WORKSPACE_ADMIN_CAPABILITY);
}
