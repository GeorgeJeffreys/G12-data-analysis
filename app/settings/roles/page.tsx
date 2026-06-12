"use client";

/**
 * Settings › Roles & permissions. A roles × capabilities checkbox grid. Tick to
 * grant; click a role name to rename; add new roles (start with nothing).
 * Defaults: G12 Lead = full; Data Scientist = all but sign-off/admin. MOCK.
 */
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Check } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { settingsSubnav } from "@/lib/ui/subnav";

export default function RolesPage() {
  const provider = useProvider();
  const model = useProviderData((p) => p.getRoles());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const isLead = provider.getCurrentUser().role === "lead_admin";

  const addRole = () => {
    if (newName.trim()) provider.createRole(newName.trim());
    setNewName("");
    setAdding(false);
  };

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
            Tick a capability to grant it to a role. Defaults give the G12 Lead full access and the Data Scientist everything except sign-off and admin. Changes save immediately.
          </div>
        </div>

        <Card style={{ overflow: "hidden", width: "fit-content", maxWidth: "100%" }}>
          {/* table header toolbar — Add role sits neatly on the right of the header bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${H.line}`, background: H.tint }}>
            <span className="hf-lbl">Roles &amp; capabilities</span>
            <div style={{ flex: 1 }} />
            {adding ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRole()} placeholder="New role name" style={{ width: 200, border: `1px solid ${H.line2}`, borderRadius: 7, padding: "6px 9px", fontSize: 12, outline: "none" }} />
                <Button variant="pri" style={{ fontSize: 11.5, padding: "6px 11px" }} onClick={addRole} disabled={!newName.trim()}>Add</Button>
                <Button variant="ghost" style={{ fontSize: 11.5, padding: "6px 9px" }} onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="ghost" style={{ fontSize: 11.5, padding: "6px 11px" }} onClick={() => setAdding(true)}><Icon name="plus" size={13} />Add role</Button>
            )}
          </div>
          <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="hf-th" style={{ minWidth: 240 }}>Capability</th>
                {model.roles.map((r) => (
                  <th key={r.id} className="hf-th" style={{ textAlign: "center", width: 150 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      {editingRole === r.id ? (
                        <input
                          autoFocus
                          defaultValue={r.name}
                          onBlur={(e) => { if (e.target.value.trim() && e.target.value !== r.name) provider.renameRole(r.id, e.target.value.trim()); setEditingRole(null); }}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          style={{ width: 110, fontSize: 11.5, padding: "2px 4px", border: `1px solid ${H.pink}`, borderRadius: 4, textAlign: "center" }}
                        />
                      ) : (
                        <button onClick={() => setEditingRole(r.id)} title="Rename role" style={{ border: "none", background: "transparent", cursor: "pointer", font: "inherit", color: r.isLead ? H.pink : H.ink, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {r.name}
                          <span aria-hidden="true" style={{ fontSize: 9, color: H.ink3 }}>✎</span>
                        </button>
                      )}
                      <span style={{ fontSize: 9, fontWeight: 500, color: H.ink3, textTransform: "none", letterSpacing: 0 }}>{r.memberCount} {r.memberCount === 1 ? "member" : "members"}</span>
                      {isLead && !r.isLead && (
                        <button
                          onClick={() => setDeleting({ id: r.id, name: r.name })}
                          disabled={r.memberCount > 0}
                          title={r.memberCount > 0 ? "Reassign its members before deleting" : "Delete role"}
                          style={{ border: "none", background: "transparent", cursor: r.memberCount > 0 ? "not-allowed" : "pointer", color: r.memberCount > 0 ? H.ink3 : H.bad, fontSize: 9.5, fontWeight: 600, textTransform: "none", letterSpacing: 0, opacity: r.memberCount > 0 ? 0.5 : 1, padding: 0, marginTop: 1 }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.groups.map((grp) => (
                <>
                  <tr key={grp.group}>
                    <td colSpan={1 + model.roles.length} style={{ padding: "9px 12px 7px", background: H.canvas, borderBottom: `1px solid ${H.line}` }}>
                      <span className="hf-lbl" style={{ fontSize: 9.5 }}>{grp.group}</span>
                    </td>
                  </tr>
                  {grp.capabilities.map((cap) => (
                    <tr key={cap.id} className="hf-hover">
                      <td className="hf-td" style={{ fontSize: 12.5, fontWeight: 500 }}>{cap.label}</td>
                      {model.roles.map((r) => (
                        <td key={r.id} className="hf-td" style={{ textAlign: "center" }}>
                          <span style={{ display: "inline-flex" }}>
                            <Check on={!!model.matrix[r.id]?.[cap.id]} onClick={() => provider.setCapability(r.id, cap.id, !model.matrix[r.id]?.[cap.id])} />
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
        <div className="hf-sub" style={{ fontSize: 12 }}>Click a role name (✎) to rename it. New roles start with no capabilities — tick what they need. A role with members must be reassigned before it can be deleted.</div>
      </div>

      {deleting && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(31,42,49,.32)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }} onClick={() => setDeleting(null)}>
          <div className="hf-card" style={{ padding: "20px 22px", maxWidth: 460, width: "100%", background: H.paper }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Icon name="lock" />
              <span className="hf-h2">Delete role “{deleting.name}”?</span>
            </div>
            <div className="hf-sub" style={{ fontSize: 12.5, marginBottom: 18 }}>
              This removes the role archetype and its capability grants from the workspace. Members keep
              their accounts but lose this role. This can’t be undone.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => { provider.deleteRole(deleting.id); setDeleting(null); }}>Delete role</Button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
