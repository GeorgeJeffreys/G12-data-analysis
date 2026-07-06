"use client";

/**
 * Settings › Users & access — the SINGLE source of truth for permissions.
 *
 * One row per PERSON (grouped by auth.users id), headline = their workspace role in
 * the one canonical vocabulary (lib/auth/roles.ts). Cycle-specific grants that differ
 * appear as an expandable "exceptions" list, never as duplicate people. Every control
 * writes to the real `memberships` table (admin-gated by C1 authorization) and takes
 * effect immediately for app.has_role — an admin manages access entirely here, no SQL.
 * A non-admin sees the page read-only.
 */
import { Fragment, useMemo, useState } from "react";
import { useProvider, useProviderData } from "@/lib/data/context";
import { hasRole } from "@/lib/auth/roles";
import { H } from "@/lib/ui/tokens";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Avatar, Badge } from "@/components/ui/primitives";
import { Icon, Mark } from "@/components/ui/icons";
import { settingsSubnav } from "@/lib/ui/subnav";

export default function UsersPage() {
  const provider = useProvider();
  const model = useProviderData((p) => p.getMembers());
  const isAdmin = useProviderData((p) => hasRole(p.getCurrentUser().role, "admin"));
  const actionError = useProviderData((p) => p.getMemberActionError?.() ?? null);
  const cycles = useProviderData((p) => p.listCycles());

  const [search, setSearch] = useState("");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(model.roles[0]?.id ?? "");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addFor, setAddFor] = useState<string | null>(null);
  const [exCycle, setExCycle] = useState("");
  const [exRole, setExRole] = useState(model.roles[0]?.id ?? "");

  const rows = useMemo(
    () =>
      model.members.filter(
        (m) => !search || `${m.name} ${m.email}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [model.members, search],
  );

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const sendInvite = () => {
    if (!email.trim()) return;
    provider.clearMemberActionError?.();
    provider.inviteMember(email.trim(), roleId || model.roles[0]?.id || "", null);
    setEmail("");
    setInviting(false);
  };

  const addException = (userId: string) => {
    if (!exCycle) return;
    provider.clearMemberActionError?.();
    provider.setMemberRole(`${userId}|${exCycle}`, exRole || model.roles[0]?.id || "");
    setAddFor(null);
    setExCycle("");
  };

  return (
    <Shell
      active="Settings"
      crumb={[{ label: "Settings" }, { label: "Users & access" }]}
      subnav={settingsSubnav("users")}
      actions={
        isAdmin ? (
          <Button variant="pri" onClick={() => setInviting((v) => !v)}>
            <Icon name="plus" color="#fff" />
            Invite person
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "26px 30px", gap: 18, flex: 1 }}>
        <div style={{ maxWidth: 640 }}>
          <div className="hf-h1">Users &amp; access</div>
          <div className="hf-sub" style={{ marginTop: 7 }}>
            {isAdmin
              ? "Each person appears once. Their workspace role is the headline; a per-cycle grant that differs shows as an exception. Every change writes real permissions immediately."
              : "You can view who has access. Only an admin can invite people or change roles."}
          </div>
        </div>

        {actionError && (
          <Card style={{ padding: "11px 14px", background: H.badSoft, borderColor: H.bad, display: "flex", alignItems: "center", gap: 10 }}>
            <Mark kind="warn" size={14} />
            <div style={{ flex: 1, fontSize: 12.5, color: H.bad }}>{actionError}</div>
            <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => provider.clearMemberActionError?.()}>Dismiss</Button>
          </Card>
        )}

        {isAdmin && inviting && (
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
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} style={selectStyle}>
              {model.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <Button variant="pri" onClick={sendInvite} disabled={!email.trim()}>Send invite</Button>
            <Button variant="ghost" onClick={() => setInviting(false)}>Cancel</Button>
          </Card>
        )}

        <label className="hf-field" style={{ width: 240 }}>
          <Icon name="search" color={H.ink3} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 12.5 }} />
        </label>

        <Card style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="hf-th">Person</th>
                <th className="hf-th" style={{ width: 210 }}>Role (workspace)</th>
                <th className="hf-th" style={{ width: 220 }}>Scope</th>
                <th className="hf-th" style={{ width: 110 }}>Status</th>
                <th className="hf-th" style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const isOpen = expanded.has(u.id);
                const hasEx = (u.exceptions?.length ?? 0) > 0;
                return (
                  <Fragment key={u.id}>
                    <tr className="hf-hover">
                      <td className="hf-td">
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <Avatar name={u.name} size={36} tone="pink" />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>
                              {u.name}
                              {u.isCurrent && <span className="hf-sub" style={{ fontSize: 11, marginLeft: 6 }}>(you)</span>}
                            </div>
                            <div className="hf-mono hf-sub" style={{ fontSize: 11.5 }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="hf-td">
                        <select
                          value={u.roleId}
                          disabled={!isAdmin}
                          onChange={(e) => { provider.clearMemberActionError?.(); provider.setMemberRole(u.id, e.target.value); }}
                          style={{ ...roleSelectStyle, cursor: isAdmin ? "pointer" : "default", opacity: isAdmin ? 1 : 0.7 }}
                        >
                          {u.roleId === "" && <option value="">— none —</option>}
                          {model.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </td>
                      <td className="hf-td">
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="hf-sub" style={{ fontSize: 12 }}>{u.scope}</span>
                          {(hasEx || isAdmin) && (
                            <button onClick={() => toggle(u.id)} className="hf-chip" style={{ cursor: "pointer", fontSize: 11 }}>
                              {isOpen ? "Hide" : hasEx ? `Exceptions (${u.exceptions!.length})` : "Add exception"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="hf-td"><Badge tone="good">Active</Badge></td>
                      <td className="hf-td" style={{ textAlign: "right" }}>
                        {isAdmin && !u.isCurrent && (
                          <Button variant="ghost" style={{ fontSize: 11, color: H.bad }} onClick={() => { provider.clearMemberActionError?.(); provider.removeMember(u.id); }}>
                            <Icon name="trash" size={13} />Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td className="hf-td" colSpan={5} style={{ background: H.canvas, padding: "8px 16px 12px 60px" }}>
                          {hasEx ? (
                            u.exceptions!.map((ex) => (
                              <div key={ex.cycleId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                                <span style={{ fontSize: 12, fontWeight: 600, minWidth: 160 }}>{ex.cycleLabel}</span>
                                <select
                                  value={ex.roleId}
                                  disabled={!isAdmin}
                                  onChange={(e) => { provider.clearMemberActionError?.(); provider.setMemberRole(`${u.id}|${ex.cycleId}`, e.target.value); }}
                                  style={roleSelectStyle}
                                >
                                  {model.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                {isAdmin && (
                                  <Button variant="ghost" style={{ fontSize: 11, color: H.bad }} onClick={() => { provider.clearMemberActionError?.(); provider.removeMember(`${u.id}|${ex.cycleId}`); }}>Remove</Button>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="hf-sub" style={{ fontSize: 12 }}>No cycle-specific exceptions.</div>
                          )}
                          {isAdmin && (
                            addFor === u.id ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                                <select value={exCycle} onChange={(e) => setExCycle(e.target.value)} style={selectStyle}>
                                  <option value="">Choose a cycle…</option>
                                  {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                <select value={exRole} onChange={(e) => setExRole(e.target.value)} style={selectStyle}>
                                  {model.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                <Button variant="pri" style={{ fontSize: 11 }} disabled={!exCycle} onClick={() => addException(u.id)}>Add</Button>
                                <Button variant="ghost" style={{ fontSize: 11 }} onClick={() => setAddFor(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <Button variant="ghost" style={{ fontSize: 11, marginTop: 6 }} onClick={() => { setAddFor(u.id); setExRole(model.roles[0]?.id ?? ""); }}>
                                <Icon name="plus" size={12} />Add a cycle exception
                              </Button>
                            )
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
        {isAdmin && (
          <div className="hf-sub" style={{ fontSize: 12 }}>
            Removing someone revokes access immediately. The last workspace admin can’t be removed or demoted.
          </div>
        )}
      </div>
    </Shell>
  );
}

const selectStyle: React.CSSProperties = { border: `1px solid ${H.line2}`, borderRadius: 7, padding: "8px 10px", fontSize: 12.5, fontFamily: "inherit", background: H.paper };
const roleSelectStyle: React.CSSProperties = { border: "1px solid transparent", borderRadius: 6, padding: "5px 6px", fontSize: 12.5, fontWeight: 600, background: "transparent", fontFamily: "inherit", color: H.ink };
