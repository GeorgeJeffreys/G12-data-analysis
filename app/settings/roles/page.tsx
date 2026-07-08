"use client";

/**
 * Settings › Roles & actions — the read surface for the dynamic role × action grid
 * (migration 0040). Roles are add/deletable rows; actions are the fixed, granular
 * catalogue grouped by pipeline step. Enforcement resolves membership role_id → the
 * role's granted actions → the gated action.
 *
 * X1 ships the model + enforcement and this READ-ONLY surface: the roles, the grid
 * (which role holds which action), and the action catalogue. The editable grid
 * (create / rename / delete roles, toggle cells) lands in X2 — the provider setters
 * (`createRole` / `renameRole` / `deleteRole` / `setRoleAction`) and their lockout
 * guards already exist behind it.
 */
import { Fragment } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { can, ACTION_GROUP_ORDER, type ActionDef } from "@/lib/auth/actions";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Card, Check } from "@/components/ui/primitives";
import { settingsSubnav } from "@/lib/ui/subnav";

/** Group a flat action list by its `group`, in the fixed pipeline-step order. */
function groupActions(actions: ActionDef[]): { group: string; items: ActionDef[] }[] {
  const byGroup = new Map<string, ActionDef[]>();
  for (const a of actions) {
    if (!byGroup.has(a.group)) byGroup.set(a.group, []);
    byGroup.get(a.group)!.push(a);
  }
  return ACTION_GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({ group, items: byGroup.get(group)! }));
}

export default function RolesPage() {
  const provider = useProvider();
  const roles = useProviderData((p) => p.getRoles());
  const roleActions = useProviderData((p) => p.getRoleActions());
  const actions = useProviderData((p) => p.getActionCatalogue());
  const members = useProviderData((p) => p.getMembers().members);
  const canManage = can(provider.getCurrentUser().role, "general.manage_roles");

  const groups = groupActions(actions);
  const memberCount = (roleId: string) => members.filter((m) => m.roleId === roleId).length;
  const holds = (roleId: string, action: string) => (roleActions[roleId] ?? []).includes(action as never);

  return (
    <Shell active="Settings" crumb={[{ label: "Settings" }, { label: "Roles & actions" }]} subnav={settingsSubnav("roles")}>
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 26, flex: 1 }}>
        <div style={{ maxWidth: 760 }}>
          <div className="hf-h1">Roles &amp; actions</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            Every role and the granular actions it holds. Actions are grouped by pipeline step; each is one
            gated operation the app enforces. Editing the grid — create, rename or delete roles, and toggle any
            cell — arrives next.
            {!canManage && " You need role management to edit — this is read-only for your role."}
          </div>
        </div>

        {/* ── Roles ────────────────────────────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="hf-h2">Roles</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {roles.map((role) => (
              <Card key={role.id} style={{ padding: "12px 15px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {role.name}
                    {role.isSystem && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: H.ink3, textTransform: "uppercase", letterSpacing: 0.3 }}>System</span>}
                  </span>
                  <span style={{ fontSize: 11, color: H.ink3 }}>
                    {(roleActions[role.id] ?? []).length} action{(roleActions[role.id] ?? []).length === 1 ? "" : "s"} · {memberCount(role.id)} member{memberCount(role.id) === 1 ? "" : "s"}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Roles × actions grid (read-only) ─────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="hf-h2">Roles &amp; actions</div>
          <Card style={{ overflow: "hidden", width: "fit-content", maxWidth: "100%" }}>
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th className="hf-th" style={{ minWidth: 300 }}>Action</th>
                    {roles.map((role) => (
                      <th key={role.id} className="hf-th" style={{ textAlign: "center", width: 150 }}>
                        <span style={{ color: role.isSystem ? H.pink : H.ink, fontWeight: 700 }}>{role.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((grp) => (
                    <Fragment key={grp.group}>
                      <tr>
                        <td className="hf-td" colSpan={roles.length + 1} style={{ background: H.canvas }}>
                          <span className="hf-lbl" style={{ fontSize: 10 }}>{grp.group}</span>
                        </td>
                      </tr>
                      {grp.items.map((a) => (
                        <tr key={a.key} className="hf-hover">
                          <td className="hf-td">
                            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.label}</span>{" "}
                            <span className="hf-mono" style={{ fontSize: 10, color: H.ink3 }}>{a.key}</span>
                          </td>
                          {roles.map((role) => (
                            <td key={role.id} className="hf-td" style={{ textAlign: "center" }}>
                              <span style={{ display: "inline-flex", opacity: holds(role.id, a.key) ? 1 : 0.25 }}>
                                <Check on={holds(role.id, a.key)} />
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* ── Action catalogue reference ───────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="hf-h2">Action catalogue</div>
          <div className="hf-sub" style={{ fontSize: 12, maxWidth: 760 }}>
            Actions are the fixed operations the app enforces, grouped by pipeline step. Roles and the grid
            above are editable at runtime; a brand-new action is added in code when the app gains a new gated
            operation.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {groups.map((grp) => (
              <Card key={grp.group} style={{ padding: "12px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
                <span className="hf-lbl" style={{ fontSize: 10 }}>{grp.group}</span>
                {grp.items.map((a) => (
                  <div key={a.key} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.label} <span className="hf-mono" style={{ fontSize: 10, color: H.ink3, fontWeight: 400 }}>{a.key}</span></span>
                    <span className="hf-sub" style={{ fontSize: 11.5 }}>{a.description}</span>
                  </div>
                ))}
              </Card>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
