"use client";

/**
 * Settings › Users & access. Invite by Microsoft email, assign a role, remove,
 * resend invites. MOCK — no real directory; lives in the in-memory provider.
 */
import { useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Avatar, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { settingsSubnav } from "@/lib/ui/subnav";

type StatusFilter = "all" | "active" | "invited";

export default function UsersPage() {
  const provider = useProvider();
  const model = useProviderData((p) => p.getMembers());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(model.roles[0]?.id ?? "");

  const rows = model.members.filter((m) => {
    if (search && !`${m.name} ${m.email}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter !== "all" && m.status !== filter) return false;
    return true;
  });

  const sendInvite = () => {
    if (!email.trim()) return;
    provider.inviteMember(email.trim(), roleId || model.roles[0]?.id || "");
    setEmail("");
    setInviting(false);
  };

  return (
    <Shell
      active="Settings"
      crumb={[{ label: "Settings" }, { label: "Users & access" }]}
      subnav={settingsSubnav("users")}
      actions={<Button variant="pri" onClick={() => setInviting((v) => !v)}><Icon name="plus" color="#fff" />Invite person</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1 }}>
        <div style={{ maxWidth: 620 }}>
          <div className="hf-h1">Users &amp; access</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            Only people invited here can sign in. Invite by Microsoft email and give them a role. Keep the circle small.
          </div>
        </div>

        {inviting && (
          <Card style={{ padding: "14px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Icon name="mail" color={H.ink3} />
            <input
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendInvite()}
              placeholder="name@alsamaproject.com"
              style={{ flex: 1, minWidth: 220, border: `1px solid ${H.line2}`, borderRadius: 7, padding: "8px 10px", fontSize: 12.5, outline: "none" }}
            />
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} style={{ border: `1px solid ${H.line2}`, borderRadius: 7, padding: "8px 10px", fontSize: 12.5, fontFamily: "inherit", background: H.paper }}>
              {model.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Button variant="pri" onClick={sendInvite} disabled={!email.trim()}>Send invite</Button>
            <Button variant="ghost" onClick={() => setInviting(false)}>Cancel</Button>
          </Card>
        )}

        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <label className="hf-field" style={{ width: 240 }}>
            <Icon name="search" color={H.ink3} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12.5 }} />
          </label>
          {(["all", "active", "invited"] as const).map((f) => (
            <span key={f} className={`hf-chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)} style={{ textTransform: "capitalize", cursor: "pointer" }}>{f}</span>
          ))}
        </div>

        <Card style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="hf-th">Person</th>
                <th className="hf-th" style={{ width: 210 }}>Role</th>
                <th className="hf-th" style={{ width: 150 }}>Status</th>
                <th className="hf-th" style={{ width: 180 }}>Last active</th>
                <th className="hf-th" style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="hf-hover">
                  <td className="hf-td">
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Avatar name={u.name} size={36} tone={u.status === "active" ? "pink" : undefined} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}{u.isCurrent && <span className="hf-sub" style={{ fontSize: 11, marginLeft: 6 }}>(you)</span>}</div>
                        <div className="hf-mono hf-sub" style={{ fontSize: 11.5 }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hf-td">
                    <select
                      value={u.roleId}
                      onChange={(e) => provider.setMemberRole(u.id, e.target.value)}
                      style={{ border: `1px solid transparent`, borderRadius: 6, padding: "5px 6px", fontSize: 12.5, fontWeight: 600, background: "transparent", fontFamily: "inherit", cursor: "pointer", color: H.ink }}
                    >
                      {model.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td className="hf-td">{u.status === "active" ? <Badge tone="good"><Mark kind="pass" size={11} />Active</Badge> : <Badge tone="warn">Invited</Badge>}</td>
                  <td className="hf-td hf-sub" style={{ fontSize: 12 }}>{u.lastActive}</td>
                  <td className="hf-td" style={{ textAlign: "right" }}>
                    {u.status === "invited" ? (
                      <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.resendInvite(u.id)}>Resend</Button>
                    ) : !u.isCurrent ? (
                      <Button variant="ghost" style={{ fontSize: 11, color: H.bad }} onClick={() => provider.removeMember(u.id)}><Icon name="trash" size={13} />Remove</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="hf-sub" style={{ fontSize: 12 }}>Removing someone revokes access immediately. Their past actions stay in the audit log.</div>
      </div>
    </Shell>
  );
}
