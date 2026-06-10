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
      actions={<Button variant="ghost" onClick={() => setAdding(true)}><Icon name="plus" />Add role</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1 }}>
        <div style={{ maxWidth: 660 }}>
          <div className="hf-h1">Roles &amp; permissions</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            Tick a capability to grant it to a role. Defaults give the G12 Lead full access and the Data Scientist everything except sign-off and admin. Changes save immediately.
          </div>
        </div>

        {adding && (
          <Card style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", maxWidth: 760 }}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRole()} placeholder="New role name" style={{ flex: 1, border: `1px solid ${H.line2}`, borderRadius: 7, padding: "8px 10px", fontSize: 12.5, outline: "none" }} />
            <Button variant="pri" onClick={addRole} disabled={!newName.trim()}>Add role</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </Card>
        )}

        <Card style={{ overflow: "auto", maxWidth: 880 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="hf-th" style={{ width: "46%" }}>Capability</th>
                {model.roles.map((r) => (
                  <th key={r.id} className="hf-th" style={{ textAlign: "center", minWidth: 130 }}>
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
                        <button onClick={() => setEditingRole(r.id)} title="Click to rename" style={{ border: "none", background: "transparent", cursor: "pointer", font: "inherit", color: r.isLead ? H.pink : H.ink, fontWeight: 700 }}>
                          {r.name}
                        </button>
                      )}
                      <span style={{ fontSize: 9, fontWeight: 500, color: H.ink3, textTransform: "none", letterSpacing: 0 }}>{r.memberCount} {r.memberCount === 1 ? "member" : "members"}</span>
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
        </Card>
        <div className="hf-sub" style={{ fontSize: 12 }}>Click a role name to rename it. New roles start with no capabilities — tick what they need.</div>
      </div>
    </Shell>
  );
}
