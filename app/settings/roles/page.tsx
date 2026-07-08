"use client";

/**
 * Settings › Roles & actions — the single role × action grid (migration 0040, X2).
 *
 * Columns are ROLES (add / rename / delete), rows are the granular ACTIONS grouped by
 * pipeline step then General, cells are checkboxes. Enforcement resolves membership
 * role_id → the role's granted actions → the gated action, so a tick takes effect
 * immediately across the app.
 *
 * Lockout protection mirrors the RPC guards: the Admin (system) column can't be
 * deleted and its general.manage_roles / general.manage_users cells are always-on and
 * disabled, so the workspace can never be locked out of role/user management. All
 * editing is gated on `general.manage_roles`; everyone else sees the grid read-only.
 */
import { Fragment, useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import {
  can,
  ACTION_GROUP_ORDER,
  MANAGE_ROLES_ACTION,
  MANAGE_USERS_ACTION,
  type ActionDef,
  type ActionKey,
} from "@/lib/auth/actions";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Check } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
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

const COL_W = 132; // role column width
const stickyLeft: React.CSSProperties = { position: "sticky", left: 0, zIndex: 2, background: H.paper };
const stickyTop: React.CSSProperties = { position: "sticky", top: 0, zIndex: 3, background: H.paper };

export default function RolesPage() {
  const provider = useProvider();
  const roles = useProviderData((p) => p.getRoles());
  const roleActions = useProviderData((p) => p.getRoleActions());
  const actions = useProviderData((p) => p.getActionCatalogue());
  const members = useProviderData((p) => p.getMembers().members);
  const canManage = can(provider.getCurrentUser().role, MANAGE_ROLES_ACTION);

  const groups = groupActions(actions);
  const memberCount = (roleId: string) => members.filter((m) => m.roleId === roleId).length;
  const holds = (roleId: string, action: string) => (roleActions[roleId] ?? []).includes(action as never);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const addRole = () => {
    const name = newName.trim();
    if (name) provider.createRole(name);
    setNewName("");
    setAdding(false);
  };
  const commitRename = (id: string) => {
    const name = renameText.trim();
    if (name) provider.renameRole(id, name);
    setRenaming(null);
  };

  /** A role column may be deleted only when it isn't the Admin system role and has
   *  no members (the RPC enforces the same; here we surface a clear reason). */
  const deleteReason = (roleId: string, isSystem: boolean): string | null => {
    if (isSystem) return "The Admin role can't be deleted.";
    const n = memberCount(roleId);
    if (n > 0) return `Reassign this role's ${n} member${n === 1 ? "" : "s"} in Users first.`;
    return null;
  };

  return (
    <Shell active="Settings" crumb={[{ label: "Settings" }, { label: "Roles & actions" }]} subnav={settingsSubnav("roles")}>
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ maxWidth: 640, flex: 1 }}>
            <div className="hf-h1">Roles &amp; actions</div>
            <div className="hf-sub" style={{ marginTop: 7 }}>
              Give each role the actions it can perform. Add or remove roles as your team needs; changes take
              effect immediately.
              {!canManage && " You need role management to edit — this is read-only for your role."}
            </div>
          </div>
          {canManage && !adding && (
            <Button variant="pri" style={{ fontSize: 12 }} onClick={() => setAdding(true)}>
              <Icon name="plus" size={13} color="#fff" />Add role
            </Button>
          )}
        </div>

        {adding && (
          <Card style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="hf-lbl" style={{ fontSize: 10 }}>New role</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addRole(); if (e.key === "Escape") { setAdding(false); setNewName(""); } }}
              placeholder="e.g. Marker"
              style={{ minWidth: 220, border: `1px solid ${H.line2}`, borderRadius: 7, padding: "8px 10px", fontSize: 12.5, outline: "none" }}
            />
            <Button variant="pri" onClick={addRole} disabled={!newName.trim()}>Add role</Button>
            <Button variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
            <span className="hf-sub" style={{ fontSize: 11 }}>Starts with no actions — tick the ones it should hold.</span>
          </Card>
        )}

        <Card style={{ overflow: "hidden", width: "fit-content", maxWidth: "100%" }}>
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 240px)" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th className="hf-th" style={{ ...stickyLeft, ...stickyTop, zIndex: 4, minWidth: 300, textAlign: "left" }}>Action</th>
                  {roles.map((role) => (
                    <th key={role.id} className="hf-th" style={{ ...stickyTop, width: COL_W, minWidth: COL_W, textAlign: "center", verticalAlign: "top" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        {renaming === role.id ? (
                          <input
                            autoFocus
                            value={renameText}
                            onChange={(e) => setRenameText(e.target.value)}
                            onBlur={() => commitRename(role.id)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitRename(role.id); if (e.key === "Escape") setRenaming(null); }}
                            style={{ width: COL_W - 20, border: `1px solid ${H.line2}`, borderRadius: 6, padding: "3px 5px", fontSize: 12, textAlign: "center" }}
                          />
                        ) : (
                          <span style={{ color: role.isSystem ? H.pink : H.ink, fontWeight: 700, fontSize: 12.5 }}>{role.name}</span>
                        )}
                        <span style={{ fontSize: 9, fontWeight: 500, color: H.ink3 }}>
                          {memberCount(role.id)} member{memberCount(role.id) === 1 ? "" : "s"}
                        </span>
                        {canManage && !role.isSystem && renaming !== role.id && (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              type="button"
                              title="Rename role"
                              onClick={() => { setRenaming(role.id); setRenameText(role.name); }}
                              style={{ ...iconBtn, fontSize: 9.5, fontWeight: 700, color: H.ink3, textTransform: "uppercase", letterSpacing: 0.3 }}
                            >
                              Rename
                            </button>
                            <DeleteRoleButton
                              reason={deleteReason(role.id, role.isSystem)}
                              onDelete={() => provider.deleteRole(role.id)}
                            />
                          </div>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((grp) => (
                  <Fragment key={grp.group}>
                    <tr>
                      <td className="hf-td" style={{ ...stickyLeft, background: H.canvas }}>
                        <span className="hf-lbl" style={{ fontSize: 10 }}>{grp.group}</span>
                      </td>
                      {roles.map((role) => (
                        <td key={role.id} className="hf-td" style={{ background: H.canvas }} />
                      ))}
                    </tr>
                    {grp.items.map((a) => (
                      <tr key={a.key} className="hf-hover">
                        <td className="hf-td" style={{ ...stickyLeft }} title={a.description}>
                          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.label}</span>
                          <div className="hf-sub" style={{ fontSize: 10.5 }}>{a.description}</div>
                        </td>
                        {roles.map((role) => {
                          const locked = role.isSystem && (a.key === MANAGE_ROLES_ACTION || a.key === MANAGE_USERS_ACTION);
                          const on = holds(role.id, a.key) || locked;
                          const interactive = canManage && !locked;
                          const title = locked
                            ? "Admin keeps role & user management so the workspace can't be locked out."
                            : !canManage
                              ? "Read-only — role management required to edit."
                              : undefined;
                          return (
                            <td key={role.id} className="hf-td" style={{ textAlign: "center" }} title={title}>
                              <span style={{ display: "inline-flex", opacity: locked ? 0.85 : on ? 1 : 0.9 }}>
                                <Check on={on} onClick={interactive ? () => provider.setRoleAction(role.id, a.key as ActionKey, !holds(role.id, a.key)) : undefined} />
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="hf-sub" style={{ fontSize: 12, maxWidth: 760 }}>
          Admin keeps role &amp; user management so the workspace can&apos;t be locked out — those two cells are
          fixed on and the Admin role can&apos;t be deleted.
        </div>
      </div>
    </Shell>
  );
}

const iconBtn: React.CSSProperties = {
  border: "none", background: "transparent", cursor: "pointer", padding: 2, display: "inline-flex", borderRadius: 4,
};

/** Trash affordance: disabled (with a reason tooltip) when the role can't be deleted;
 *  otherwise a two-step confirm so a column isn't dropped by a stray click. */
function DeleteRoleButton({ reason, onDelete }: { reason: string | null; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (reason) {
    return (
      <button type="button" title={reason} disabled style={{ ...iconBtn, cursor: "not-allowed", opacity: 0.4 }}>
        <Icon name="trash" size={11} color={H.ink3} />
      </button>
    );
  }
  if (confirm) {
    return (
      <button
        type="button"
        title="Click again to delete this role"
        onClick={() => { onDelete(); setConfirm(false); }}
        onBlur={() => setConfirm(false)}
        style={{ ...iconBtn, color: H.bad, fontSize: 9, fontWeight: 700 }}
      >
        <Icon name="trash" size={11} color={H.bad} />
      </button>
    );
  }
  return (
    <button type="button" title="Delete role" onClick={() => setConfirm(true)} style={iconBtn}>
      <Icon name="trash" size={11} color={H.ink3} />
    </button>
  );
}
