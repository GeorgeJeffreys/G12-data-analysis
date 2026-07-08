"use client";

/**
 * Settings › Roles & permissions — the admin surface for the configurable
 * authorization model (0039). Three sections:
 *
 *   A · Permissions        — create / edit / delete the admin-defined named bundles
 *                            of capabilities (getPermissions + create/update/delete).
 *   B · Roles × permissions — grant those permissions to the three fixed tiers
 *                            (setRoleGrant). The Admin × Workspace-administration
 *                            grant is locked on (mirrors the RPC lockout).
 *   C · Capability catalogue — the fixed code operations, read-only reference.
 *
 * All editing (A + B) is gated on `workspace_admin`; everyone else sees it
 * read-only. Enforcement resolves role → granted permissions → capabilities, so a
 * change takes effect across the app immediately.
 */
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import {
  can,
  guardsWorkspaceAdmin,
  WORKSPACE_ADMIN_CAPABILITY,
  type Capability,
  type CapabilityDef,
  type Permission,
} from "@/lib/auth/permissions";
import { ROLE_TIERS, ROLE_TIER_LABEL, type RoleTier } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Check } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { settingsSubnav } from "@/lib/ui/subnav";

/** Group a flat capability list by its `group`, preserving first-seen order. */
function groupCaps(caps: CapabilityDef[]): { group: string; items: CapabilityDef[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, CapabilityDef[]>();
  for (const c of caps) {
    if (!byGroup.has(c.group)) { byGroup.set(c.group, []); order.push(c.group); }
    byGroup.get(c.group)!.push(c);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

export default function RolesPage() {
  const provider = useProvider();
  const permissions = useProviderData((p) => p.getPermissions());
  const grants = useProviderData((p) => p.getRoleGrants());
  const capabilities = useProviderData((p) => p.getCapabilities());
  const members = useProviderData((p) => p.getMembers().members);
  const canEdit = can(provider.getCurrentUser().role, "workspace_admin");

  const capLabel = new Map(capabilities.map((c) => [c.key, c.label]));
  const capGroups = groupCaps(capabilities);
  const memberCount = (tier: RoleTier) => members.filter((m) => m.roleId === tier).length;

  // editor: null = closed; { perm: null } = create; { perm } = edit.
  const [editor, setEditor] = useState<{ perm: Permission | null } | null>(null);
  const [deleting, setDeleting] = useState<Permission | null>(null);

  return (
    <Shell active="Settings" crumb={[{ label: "Settings" }, { label: "Roles & permissions" }]} subnav={settingsSubnav("roles")}>
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 26, flex: 1 }}>
        <div style={{ maxWidth: 720 }}>
          <div className="hf-h1">Roles &amp; permissions</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            Compose permissions from the capability catalogue, then grant them to roles. Changes take effect
            immediately across the app.
            {!canEdit && " You need workspace administration to edit — this is read-only for your role."}
          </div>
        </div>

        {/* ── A · Permissions ─────────────────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="hf-h2">Permissions</div>
            <div style={{ flex: 1 }} />
            {canEdit && (
              <Button variant="pri" style={{ fontSize: 12 }} onClick={() => setEditor({ perm: null })}>
                <Icon name="plus" size={13} color="#fff" />New permission
              </Button>
            )}
          </div>
          <div className="hf-sub" style={{ fontSize: 12, maxWidth: 720 }}>
            Your own named bundles of capabilities. Grant them to roles in the grid below.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {permissions.map((perm) => (
              <Card key={perm.id} style={{ padding: "12px 15px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {perm.name}
                    {perm.isSystem && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: H.ink3, textTransform: "uppercase", letterSpacing: 0.3 }}>System</span>}
                  </span>
                  {perm.description && <span className="hf-sub" style={{ fontSize: 11.5 }}>{perm.description}</span>}
                  <span style={{ fontSize: 11, color: H.ink3 }}>
                    {perm.capabilities.length} {perm.capabilities.length === 1 ? "capability" : "capabilities"}
                    {perm.capabilities.length > 0 && ": "}
                    {perm.capabilities.map((c) => capLabel.get(c) ?? c).join(", ")}
                  </span>
                </div>
                {canEdit && (
                  <div style={{ display: "flex", gap: 7 }}>
                    <Button variant="ghost" style={{ fontSize: 11.5 }} onClick={() => setEditor({ perm })}>Edit</Button>
                    <Button
                      variant="ghost"
                      style={{ fontSize: 11.5, color: perm.isSystem ? H.ink3 : H.bad, cursor: perm.isSystem ? "not-allowed" : "pointer", opacity: perm.isSystem ? 0.5 : 1 }}
                      onClick={() => { if (!perm.isSystem) setDeleting(perm); }}
                      title={perm.isSystem ? "System permissions can't be deleted." : "Delete permission"}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>

        {/* ── B · Roles × permissions ─────────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="hf-h2">Roles &amp; permissions</div>
          <Card style={{ overflow: "hidden", width: "fit-content", maxWidth: "100%" }}>
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
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{perm.name}</span>
                        {perm.isSystem && <span style={{ marginLeft: 7, fontSize: 9, fontWeight: 700, color: H.ink3, textTransform: "uppercase", letterSpacing: 0.3 }}>System</span>}
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
          <div className="hf-sub" style={{ fontSize: 12, maxWidth: 720 }}>
            Always on — the Admin role must keep Workspace administration so the workspace can never be
            locked out. That grant is fixed on and the permission can&apos;t be deleted.
          </div>
        </section>

        {/* ── C · Capability catalogue ────────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="hf-h2">Capability catalogue</div>
          <div className="hf-sub" style={{ fontSize: 12, maxWidth: 720 }}>
            Capabilities are the fixed operations the app enforces. Permissions above are your own named
            bundles of them — create and grant them freely; new capabilities are added in code when the app
            gains a new gated action.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {capGroups.map((grp) => (
              <Card key={grp.group} style={{ padding: "12px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
                <span className="hf-lbl" style={{ fontSize: 10 }}>{grp.group}</span>
                {grp.items.map((c) => (
                  <div key={c.key} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.label} <span className="hf-mono" style={{ fontSize: 10, color: H.ink3, fontWeight: 400 }}>{c.key}</span></span>
                    <span className="hf-sub" style={{ fontSize: 11.5 }}>{c.description}</span>
                  </div>
                ))}
              </Card>
            ))}
          </div>
        </section>
      </div>

      {editor && (
        <PermissionEditor
          perm={editor.perm}
          capGroups={capGroups}
          onCancel={() => setEditor(null)}
          onSave={(name, description, caps) => {
            if (editor.perm) provider.updatePermission(editor.perm.id, name, description, caps);
            else provider.createPermission(name, description, caps);
            setEditor(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDelete
          perm={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => { provider.deletePermission(deleting.id); setDeleting(null); }}
        />
      )}
    </Shell>
  );
}

/** One grant cell. The Workspace-administration system permission × admin is
 *  always-on and disabled; read-only for non-admins; otherwise a live toggle. */
function GrantCell({ perm, tier, granted, canEdit, onToggle }: {
  perm: Permission; tier: RoleTier; granted: boolean; canEdit: boolean; onToggle: () => void;
}) {
  const locked = tier === "admin" && guardsWorkspaceAdmin(perm);
  const interactive = canEdit && !locked;
  const title = locked
    ? "Always on — the Admin role must keep workspace administration so the workspace can never be locked out."
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

const OVERLAY: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(31,42,49,.32)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
};

/** Create / edit a permission: name, description, and a grouped capability picker.
 *  For a system permission the protected capability is locked ticked. */
function PermissionEditor({ perm, capGroups, onCancel, onSave }: {
  perm: Permission | null;
  capGroups: { group: string; items: CapabilityDef[] }[];
  onCancel: () => void;
  onSave: (name: string, description: string, caps: Capability[]) => void;
}) {
  const [name, setName] = useState(perm?.name ?? "");
  const [description, setDescription] = useState(perm?.description ?? "");
  const [caps, setCaps] = useState<Set<Capability>>(new Set(perm?.capabilities ?? []));
  const isSystem = perm?.isSystem ?? false;

  const toggle = (key: Capability, locked: boolean) => {
    if (locked) return;
    setCaps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const save = () => { if (name.trim()) onSave(name.trim(), description.trim(), [...caps]); };

  return (
    <div style={OVERLAY} onClick={onCancel}>
      <div className="hf-card" style={{ padding: "20px 22px", maxWidth: 560, width: "100%", maxHeight: "85vh", overflow: "auto", background: H.paper }} onClick={(e) => e.stopPropagation()}>
        <div className="hf-h2" style={{ marginBottom: 14 }}>{perm ? "Edit permission" : "New permission"}</div>

        <label className="hf-lbl" style={{ fontSize: 10 }}>Name</label>
        <input className="hf-textinput" style={{ width: "100%", marginTop: 4, marginBottom: 12 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marker" autoFocus />

        <label className="hf-lbl" style={{ fontSize: 10 }}>Description</label>
        <input className="hf-textinput" style={{ width: "100%", marginTop: 4, marginBottom: 14 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this permission is for" />

        <label className="hf-lbl" style={{ fontSize: 10 }}>Capabilities</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
          {capGroups.map((grp) => (
            <div key={grp.group} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span className="hf-lbl" style={{ fontSize: 9.5, color: H.ink3 }}>{grp.group}</span>
              {grp.items.map((c) => {
                const key = c.key as Capability;
                const locked = isSystem && key === WORKSPACE_ADMIN_CAPABILITY;
                const on = caps.has(key) || locked;
                return (
                  <div key={c.key} style={{ display: "flex", gap: 9, alignItems: "flex-start" }} title={locked ? "Required for the Workspace administration permission." : undefined}>
                    <span style={{ display: "inline-flex", marginTop: 1, opacity: locked ? 0.7 : 1 }}>
                      <Check on={on} onClick={locked ? undefined : () => toggle(key, locked)} />
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{c.label}{locked && <span style={{ marginLeft: 6, fontSize: 9, color: H.ink3 }}>required</span>}</span>
                      <span className="hf-sub" style={{ fontSize: 11 }}>{c.description}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="pri" onClick={save} disabled={!name.trim()}>{perm ? "Save permission" : "Create permission"}</Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDelete({ perm, onCancel, onConfirm }: { perm: Permission; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div style={OVERLAY} onClick={onCancel}>
      <div className="hf-card" style={{ padding: "20px 22px", maxWidth: 440, width: "100%", background: H.paper }} onClick={(e) => e.stopPropagation()}>
        <div className="hf-h2" style={{ marginBottom: 10 }}>Delete permission “{perm.name}”?</div>
        <div className="hf-sub" style={{ fontSize: 12.5, marginBottom: 18 }}>
          This removes the permission and revokes its capabilities from every role that held it. This can&apos;t be undone.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>Delete permission</Button>
        </div>
      </div>
    </div>
  );
}
