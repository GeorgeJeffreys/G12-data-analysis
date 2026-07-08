"use client";

/**
 * Settings › Roles & permissions — grant admin-defined PERMISSIONS to the three
 * fixed canonical tiers.
 *
 * Rows = permissions (admin-editable bundles of capabilities, `getPermissions()`);
 * columns = the tiers (team_member / analyst / admin); cells = live grant toggles
 * that write through `setRoleGrant`. Enforcement resolves role → granted
 * permissions → capabilities, so a toggle changes what the tier can do across the
 * app immediately. Each permission lists the capabilities it bundles.
 *
 * Editing is gated on `workspace_admin`; everyone else sees it read-only. The
 * Workspace-administration system permission can never be un-granted from admin
 * (always-on & disabled) — the RPC refuses it too.
 *
 * (Composing permissions — create / edit which capabilities a permission bundles —
 * arrives with the permission editor; this surface grants the existing set.)
 */
import { useProvider, useProviderData } from "@/lib/data/context";
import { can, guardsWorkspaceAdmin, type Permission } from "@/lib/auth/permissions";
import { ROLE_TIERS, ROLE_TIER_LABEL, type RoleTier } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Card, Check } from "@/components/ui/primitives";
import { settingsSubnav } from "@/lib/ui/subnav";

export default function RolesPage() {
  const provider = useProvider();
  const permissions = useProviderData((p) => p.getPermissions());
  const grants = useProviderData((p) => p.getRoleGrants());
  const capabilities = useProviderData((p) => p.getCapabilities());
  const members = useProviderData((p) => p.getMembers().members);
  const canEdit = can(provider.getCurrentUser().role, "workspace_admin");

  const capLabel = new Map(capabilities.map((c) => [c.key, c.label]));
  const memberCount = (tier: RoleTier) => members.filter((m) => m.roleId === tier).length;

  return (
    <Shell
      active="Settings"
      crumb={[{ label: "Settings" }, { label: "Roles & permissions" }]}
      subnav={settingsSubnav("roles")}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1 }}>
        <div style={{ maxWidth: 680 }}>
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
                  <th className="hf-th" style={{ minWidth: 300 }}>Permission</th>
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
                {permissions.map((perm) => (
                  <tr key={perm.id} className="hf-hover">
                    <td className="hf-td">
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                          {perm.name}
                          {perm.isSystem && <span style={{ marginLeft: 7, fontSize: 9, fontWeight: 700, color: H.ink3, textTransform: "uppercase", letterSpacing: 0.3 }}>System</span>}
                        </span>
                        <span style={{ fontSize: 10.5, color: H.ink3 }}>
                          {perm.capabilities.map((c) => capLabel.get(c) ?? c).join(" · ")}
                        </span>
                      </div>
                    </td>
                    {ROLE_TIERS.map((tier) => (
                      <GrantCell
                        key={tier}
                        perm={perm}
                        tier={tier}
                        granted={(grants[tier] ?? []).includes(perm.id)}
                        canEdit={canEdit}
                        onToggle={() => provider.setRoleGrant(tier, perm.id, !(grants[tier] ?? []).includes(perm.id))}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="hf-sub" style={{ fontSize: 12 }}>
          The Admin role always keeps Workspace administration (managing users, permissions, centres &amp;
          deletion), so the workspace can never be locked out — that grant is fixed on.
        </div>
      </div>
    </Shell>
  );
}

/** One grant cell. The Workspace-administration system permission × admin is
 *  always-on and disabled; read-only for non-admins; otherwise a live toggle. */
function GrantCell({
  perm,
  tier,
  granted,
  canEdit,
  onToggle,
}: {
  perm: Permission;
  tier: RoleTier;
  granted: boolean;
  canEdit: boolean;
  onToggle: () => void;
}) {
  const locked = tier === "admin" && guardsWorkspaceAdmin(perm);
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
