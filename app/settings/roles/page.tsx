"use client";

/**
 * Settings › Roles & permissions — the REAL, editable permission matrix.
 *
 * Rows = permissions (grouped via PERMISSION_GROUPS); columns = the three fixed
 * canonical tiers (team_member / analyst / admin). Each cell is a live toggle that
 * writes through `provider.setRolePermission`, which changes what the role can do
 * across the app (P2 enforces on this same map). The three roles are FIXED — only
 * their permissions are editable; there is no custom-role machinery any more.
 *
 * Editing is gated on `workspace_admin`; everyone else sees it read-only. The
 * admin × workspace_admin cell (and any ADMIN_LOCKED_PERMISSIONS) is always-on and
 * disabled so the workspace can never lock itself out — the RPC refuses it too.
 */
import { Fragment } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import {
  PERMISSION_GROUPS,
  can,
  isAdminLocked,
  type Permission,
} from "@/lib/auth/permissions";
import { ROLE_TIERS, ROLE_TIER_LABEL, type RoleTier } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Card, Check } from "@/components/ui/primitives";
import { settingsSubnav } from "@/lib/ui/subnav";

export default function RolesPage() {
  const provider = useProvider();
  const map = useProviderData((p) => p.getRolePermissions());
  const members = useProviderData((p) => p.getMembers().members);
  const canEdit = can(provider.getCurrentUser().role, "workspace_admin");

  const memberCount = (tier: RoleTier) => members.filter((m) => m.roleId === tier).length;

  return (
    <Shell
      active="Settings"
      crumb={[{ label: "Settings" }, { label: "Roles & permissions" }]}
      subnav={settingsSubnav("roles")}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1 }}>
        <div style={{ maxWidth: 660 }}>
          <div className="hf-h1">Roles &amp; permissions</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            Grant each role the permissions it needs. Changes take effect immediately across the app.
            {!canEdit && " You need workspace administration to edit — this is read-only for your role."}
          </div>
        </div>

        <Card style={{ overflow: "hidden", width: "fit-content", maxWidth: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${H.line}`, background: H.tint }}>
            <span className="hf-lbl">Permissions by role</span>
          </div>
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="hf-th" style={{ minWidth: 260 }}>Permission</th>
                  {ROLE_TIERS.map((tier) => (
                    <th key={tier} className="hf-th" style={{ textAlign: "center", width: 150 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                        <span style={{ color: tier === "admin" ? H.pink : H.ink, fontWeight: 700 }}>{ROLE_TIER_LABEL[tier]}</span>
                        <span style={{ fontSize: 9, fontWeight: 500, color: H.ink3, textTransform: "none", letterSpacing: 0 }}>
                          {memberCount(tier)} {memberCount(tier) === 1 ? "member" : "members"}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_GROUPS.map((grp) => (
                  <Fragment key={grp.group}>
                    <tr>
                      <td colSpan={1 + ROLE_TIERS.length} style={{ padding: "9px 12px 7px", background: H.canvas, borderBottom: `1px solid ${H.line}` }}>
                        <span className="hf-lbl" style={{ fontSize: 9.5 }}>{grp.group}</span>
                      </td>
                    </tr>
                    {grp.items.map((item) => (
                      <tr key={item.id} className="hf-hover">
                        <td className="hf-td" style={{ fontSize: 12.5, fontWeight: 500 }}>{item.label}</td>
                        {ROLE_TIERS.map((tier) => (
                          <PermissionCell
                            key={tier}
                            tier={tier}
                            permission={item.id}
                            granted={map[tier].has(item.id)}
                            canEdit={canEdit}
                            onToggle={() => provider.setRolePermission(tier, item.id, !map[tier].has(item.id))}
                          />
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="hf-sub" style={{ fontSize: 12 }}>
          The Admin role always keeps workspace administration (managing users, roles, centres &amp; deletion),
          so the workspace can never be locked out — that cell is fixed on.
        </div>
      </div>
    </Shell>
  );
}

/** One matrix cell. Locked (admin × an admin-locked permission) → always-on and
 *  disabled; read-only for non-admins; otherwise a live toggle. */
function PermissionCell({
  tier,
  permission,
  granted,
  canEdit,
  onToggle,
}: {
  tier: RoleTier;
  permission: Permission;
  granted: boolean;
  canEdit: boolean;
  onToggle: () => void;
}) {
  const locked = tier === "admin" && isAdminLocked(permission);
  const interactive = canEdit && !locked;
  const title = locked
    ? "Always on — the Admin role must retain workspace administration."
    : !canEdit
      ? "Read-only — workspace administration required to edit."
      : undefined;
  return (
    <td className="hf-td" style={{ textAlign: "center" }} title={title}>
      <span style={{ display: "inline-flex", opacity: locked ? 0.85 : 1 }}>
        <Check on={locked ? true : granted} onClick={interactive ? onToggle : undefined} />
      </span>
    </td>
  );
}
